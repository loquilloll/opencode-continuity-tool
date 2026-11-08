// Keep the shared entry free of either host's SDK; each loader activates only its adapter.
import os from "node:os"
import path from "node:path"
import { executeContinuity, continuityScope } from "./runtime.js"
import { createScheduler } from "./scheduler.js"

export function globalConfigRoot(env = process.env, home = os.homedir()) {
  return env.OPENCODE_CONFIG_DIR ?? path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode")
}

export function actualDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Continuity requires an authoritative absolute session directory")
  return directory
}

export function modelRef(model) {
  const slash = typeof model === "string" ? model.indexOf("/") : -1
  if (slash <= 0 || slash === model.length - 1 || model.includes("#")) throw new Error("Continuity requires an explicit provider/model without a variant")
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

export function checkLimits(model, maxOutputTokens, { floor = 4000, reasoning = null } = {}) {
  if (!model || !Number.isInteger(maxOutputTokens) || maxOutputTokens < floor ||
      !(model.limit?.context >= 16000) || !(model.limit?.output >= floor) ||
      (model.limit?.input !== undefined && model.limit.input < 12000)) {
    throw new Error("Configured continuity model is unavailable or cannot support 16000 total tokens (12000 input + 4000 output)")
  }
  // A reasoning model whose output limit is below the requested budget can spend the entire
  // completion on reasoning and return no text on every paid attempt (observed live).
  if (reasoning && reasoning !== "none" && model.limit.output < maxOutputTokens) {
    throw new Error(`Configured continuity model output limit ${model.limit.output} cannot fit reasoning "${reasoning}" plus ${floor} tokens of text; disable reasoning or pick a model with output >= ${maxOutputTokens}`)
  }
  // Reasoning models spend completion budget on reasoning; request headroom but never exceed the model's output limit.
  return Math.min(maxOutputTokens, model.limit.output)
}

export async function bridge({ directory, lookup, generate, report = console.error }, dependencies = {}) {
  const execute = dependencies.executeContinuity ?? executeContinuity
  const scopeFor = dependencies.continuityScope ?? continuityScope
  const scheduler = (dependencies.createScheduler ?? createScheduler)({ generate, report })
  let closed = false
  try {
    const scope = await scopeFor({}, { worktree: actualDirectory(directory) })
    await scheduler.remember(scope, undefined, true)
  } catch (error) { scheduler.close(); throw error }
  return {
    async execute(args, sessionID) {
      if (closed) throw new Error("Continuity plugin is disposed")
      if (!sessionID) throw new Error("Continuity tool requires a calling sessionID")
      const context = await lookup(sessionID)
      if (!context) throw new Error("Continuity generation sessions cannot call tools")
      context.worktree = actualDirectory(context.worktree)
      await scheduler.remember(await scopeFor({}, context), sessionID, false)
      return execute(args, context, {
        globalConfigRoot: globalConfigRoot(), generate,
        onPending: (scope, id) => { void scheduler.remember(scope, id, false).catch(report) },
      })
    },
    async observe(sessionID, idle) {
      if (closed) return
      const context = await lookup(sessionID)
      if (!context) return
      context.worktree = actualDirectory(context.worktree)
      await scheduler.remember(await scopeFor({}, context), sessionID, idle)
      await scheduler.status(sessionID, idle)
    },
    async forget(sessionID) {
      if (!closed) scheduler.forget(sessionID)
    },
    close() { closed = true; scheduler.close() },
  }
}

export default {
  id: "opencode-continuity",
  async server(input) { return (await import("./plugin-v1.js")).server(input) },
  async setup(context) { return (await import("./plugin-v2.js")).setup(context) },
}
