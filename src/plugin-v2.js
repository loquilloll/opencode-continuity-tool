// V2's bounded auxiliary generation uses an owned session, never a user's history or the legacy SDK.
import path from "node:path"
import { input, description } from "./schema.js"
import { bridge, actualDirectory, modelRef, checkLimits } from "./plugin.js"

const marker = "continuityDistiller"
const denial = [{ action: "*", resource: "*", effect: "deny" }]

export function generator(context, owned = new Map()) {
  const controllers = new Set()
  const jobs = new Set()
  let closed = false
  const run = async ({ prompt, model, maxOutputTokens, signal, reasoning }) => {
    if (closed) throw new Error("Continuity plugin is disposed")
    signal?.throwIfAborted()
    const ref = modelRef(model)
    const catalog = await context.model.list({ types: ["chat"] })
    const selected = catalog.data.find((item) => item.providerID === ref.providerID && item.id === ref.modelID && item.enabled)
    const outputBudget = checkLimits(selected, maxOutputTokens, { reasoning })
    const selectedRef = { providerID: ref.providerID, id: ref.modelID }
    const directory = actualDirectory(context.location?.directory)
    const controller = new AbortController()
    controllers.add(controller)
    const cancel = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted || closed) controller.abort()
    let id, registration, interrupting, rejectAbort
    const aborted = new Promise((_, reject) => { rejectAbort = reject })
    void aborted.catch(() => {})
    const interrupt = () => {
      if (id) {
        interrupting ??= context.session.interrupt({ sessionID: id, resume: false })
        void interrupting.catch(() => {})
      }
    }
    const abort = () => { interrupt(); rejectAbort(controller.signal.reason ?? new Error("Continuity generation cancelled")) }
    controller.signal.addEventListener("abort", abort, { once: true })
    try {
      controller.signal.throwIfAborted()
      const session = await context.session.create({
        title: "[continuity distiller]", location: { directory }, model: selectedRef,
        metadata: { [marker]: true }, permissions: denial,
      })
      id = session.id
      if (!id) throw new Error("V2 did not return an owned generation session ID")
      owned.set(id, true)
      controller.signal.throwIfAborted()
      const saved = await context.session.get({ sessionID: id })
      if (saved.id !== id || saved.metadata?.[marker] !== true || saved.parentID ||
          JSON.stringify(saved.permissions) !== JSON.stringify(denial) ||
          saved.model?.providerID !== selectedRef.providerID || saved.model?.id !== selectedRef.id ||
          path.resolve(actualDirectory(saved.location?.directory)) !== path.resolve(directory)) {
        throw new Error("V2 generation ownership, model, location or wildcard denial was not persisted")
      }
      let bounded = false
      registration = await context.session.hook("generate", (event) => {
        if (event.sessionID !== id) return
        if (event.model.providerID !== selectedRef.providerID || event.model.id !== selectedRef.id) {
          throw new Error("V2 generation resolved a different model")
        }
        // Auxiliary generation otherwise includes global/project instructions and tool definitions.
        event.system = []
        event.messages = [{ role: "user", content: [{ type: "text", text: prompt }] }]
        event.tools = {}
        event.options = { maxTokens: outputBudget, ...(reasoning ? { reasoningEffort: reasoning } : {}) }
        bounded = true
      })
      controller.signal.throwIfAborted()
      const result = await Promise.race([context.session.generate({ sessionID: id, prompt }), aborted])
      controller.signal.throwIfAborted()
      if (!bounded) throw new Error("V2 generation hook did not apply the output bound")
      if (typeof result?.text !== "string" || !result.text) throw new Error("Continuity model returned no text")
      return result.text
    } finally {
      signal?.removeEventListener("abort", cancel)
      controller.signal.removeEventListener("abort", abort)
      try {
        if (id) {
          interrupt()
          try { await interrupting } catch {}
          try { await context.session.remove({ sessionID: id }) }
          catch (error) { console.error(`[continuity] V2 generation-session cleanup failed: ${error.message}`) }
        }
      } finally {
        try { await registration?.dispose() }
        finally { if (id) owned.delete(id); controllers.delete(controller) }
      }
    }
  }
  const generate = (request) => {
    const job = run(request)
    jobs.add(job)
    void job.finally(() => jobs.delete(job)).catch(() => {})
    return job
  }
  generate.close = async () => {
    closed = true
    for (const controller of controllers) controller.abort()
    await Promise.allSettled(jobs)
  }
  return generate
}

export async function setup(context, dependencies = {}) {
  const owned = new Map()
  const attributed = new Map()
  const deleted = new Set()
  const terminal = new Set()
  const backgroundBusy = new Set()
  const generate = generator(context, owned)
  const lookup = async (sessionID) => {
    if (owned.has(sessionID)) return null
    if (deleted.has(sessionID)) return attributed.get(sessionID) ?? null
    const session = await context.session.get({ sessionID })
    if (session.metadata?.[marker]) return null
    if (session.id !== sessionID) throw new Error("V2 session attribution mismatch")
    // A delayed terminal event cannot make a subsequently restarted execution idle.
    if (terminal.has(sessionID) && session.time?.busy > (session.time?.idle ?? -Infinity)) return null
    const result = { sessionID, worktree: actualDirectory(session.location?.directory) }
    attributed.set(sessionID, result)
    return result
  }
  const app = await bridge({ directory: context.location?.directory, lookup, generate }, dependencies)
  const registrations = []
  const eventsController = new AbortController()
  let events
  try {
    registrations.push(await context.tool.transform((editor) => editor.add({
      name: "continuity", description, input,
      execute: async (args, toolContext) => {
        const result = await app.execute(args, toolContext.sessionID)
        return { content: typeof result === "string" ? result : JSON.stringify(result) }
      },
    })))
    registrations.push(await context.session.hook("prompt", ({ sessionID }) => app.observe(sessionID, false).catch((error) => console.error(`[continuity] ${error.message}`))))
    registrations.push(await context.session.hook("experimental.idle", ({ sessionID, background }) => {
      if (background.length) backgroundBusy.add(sessionID)
      else backgroundBusy.delete(sessionID)
      return app.observe(sessionID, background.length === 0).catch((error) => console.error(`[continuity] ${error.message}`))
    }))
    const stream = context.event.subscribe({ signal: eventsController.signal, types: [
      "session.execution.started", "session.execution.succeeded", "session.execution.failed",
      "session.execution.interrupted", "session.deleted",
    ] })
    events = (async () => {
      for await (const event of stream) {
        // One flaky lookup must not permanently deactivate the plugin; only stream end may.
        try {
          const id = event.data?.sessionID
          if (!id || owned.has(id) || !attributed.has(id)) continue
          if (event.type === "session.execution.started") await app.observe(id, false)
          else if (event.type === "session.deleted") {
            deleted.add(id)
            try { await app.observe(id, true) } finally { app.forget(id); deleted.delete(id); attributed.delete(id); backgroundBusy.delete(id) }
          } else if (!backgroundBusy.has(id)) {
            terminal.add(id)
            try { await app.observe(id, true) } finally { terminal.delete(id) }
          }
        } catch (error) { console.error(`[continuity] event skipped: ${error.message}`) }
      }
      if (!eventsController.signal.aborted) throw new Error("V2 execution event stream ended; reload continuity plugin")
    })().catch(async (error) => {
      if (!eventsController.signal.aborted) {
        console.error(`[continuity] ${error.message}`)
        app.close()
        await generate.close()
      }
    })
  } catch (error) {
    eventsController.abort()
    app.close()
    await generate.close()
    for (const registration of registrations) await registration.dispose()
    throw error
  }
  return async () => {
    app.close(); eventsController.abort()
    await generate.close()
    await events
    for (const registration of registrations) await registration.dispose()
    attributed.clear(); backgroundBusy.clear()
  }
}
