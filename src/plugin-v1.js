// V1 owns fresh, wildcard-denied sessions; never reuse a user's session for generation.
import { bridge, actualDirectory, modelRef, checkLimits } from "./plugin.js"
import { tokens } from "./core.js"

const marker = "continuityDistiller"
const denial = [{ permission: "*", pattern: "*", action: "deny" }]
function data(response, operation, allowEmpty = false) {
  const status = response?.response?.status
  if (response?.error || (response?.data === undefined && !(allowEmpty && status >= 200 && status < 300)) || status >= 400) {
    const name = response?.error?.name ?? response?.error?._tag
    const type = typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}Error$/.test(name) ? name : "UnknownError"
    const http = Number.isInteger(status) && status >= 100 && status <= 599 ? status : "unknown"
    throw new Error(`Continuity V1 ${operation} failed (HTTP ${http}; ${type})`)
  }
  return response.data
}

export async function server(input, dependencies = {}) {
  const client = input.client
  const owned = new Map()
  const controllers = new Set()
  const jobs = new Set()
  const report = dependencies.report ?? console.error
  let closed = false
  const runGenerate = async ({ prompt, model, signal, maxOutputTokens, reasoning }) => {
    if (closed) throw new Error("Continuity plugin is disposed")
    const ref = modelRef(model)
    const catalog = data(await client.provider.list(), "provider.list")
    const provider = catalog.all.find((item) => item.id === ref.providerID)
    if (!catalog.connected.includes(ref.providerID)) throw new Error("Configured continuity provider is not connected")
    const outputBudget = checkLimits(provider?.models?.[ref.modelID], maxOutputTokens, { reasoning })
    const controller = new AbortController()
    controllers.add(controller)
    const cancel = () => controller.abort()
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted || closed) controller.abort()
    let id
    let aborting
    let completed = false
    let failure
    const abort = () => {
      if (id) {
        aborting ??= client.session.abort({ path: { id } }).then((response) => data(response, "session.abort", true))
        void aborting.catch(() => {})
      }
    }
    controller.signal.addEventListener("abort", abort, { once: true })
    try {
      controller.signal.throwIfAborted()
      const session = data(await client.session.create({ body: {
        title: "[continuity distiller]", metadata: { [marker]: true }, permission: denial,
        model: { providerID: ref.providerID, id: ref.modelID },
      } }), "session.create")
      id = session.id
      if (!id) throw new Error("V1 did not return an owned generation session ID")
      owned.set(id, { prompt, maxOutputTokens: outputBudget, reasoning: reasoning ?? null, messagesCleared: false, systemCleared: false, sent: false })
      controller.signal.throwIfAborted()
      const saved = data(await client.session.get({ path: { id } }), "session.get(generation)")
      if (saved.id !== id || saved.model?.providerID !== ref.providerID || saved.model?.id !== ref.modelID ||
          saved.metadata?.[marker] !== true || JSON.stringify(saved.permission) !== JSON.stringify(denial)) {
        throw new Error("V1 wildcard denial/model/ownership was not persisted before the first prompt")
      }
      const result = data(await client.session.prompt({ path: { id }, body: {
        model: ref, tools: { "*": false }, parts: [{ type: "text", text: prompt }],
      }, signal: controller.signal }), "session.prompt")
      controller.signal.throwIfAborted()
      if (result.info?.error) throw new Error("Continuity model generation failed")
      const text = result.parts.filter((part) => part.type === "text").map((part) => part.text).join("")
      if (!text) throw new Error("Continuity model returned no text")
      completed = true
      return text
    } catch (error) {
      failure = error
      throw error
    } finally {
      signal?.removeEventListener("abort", cancel)
      controller.signal.removeEventListener("abort", abort)
      let cleanupError
      if (id) {
        try { if (!completed) { abort(); await aborting } } catch (error) { cleanupError = error }
        try { data(await client.session.delete({ path: { id } }), "session.delete", true) }
        catch (error) { cleanupError ??= error }
        owned.delete(id)
      }
      controllers.delete(controller)
      // Cleanup errors must never discard a completed (paid) generation result.
      if (cleanupError) report(`[continuity] V1 owned-session cleanup failed: ${cleanupError.message}`)
    }
  }
  const generate = (request) => {
    const job = runGenerate(request)
    jobs.add(job)
    void job.finally(() => jobs.delete(job)).catch(() => {})
    return job
  }
  const lookup = async (sessionID) => {
    if (owned.has(sessionID)) return null
    const session = data(await client.session.get({ path: { id: sessionID } }), "session.get(caller)")
    if (session.metadata?.[marker]) return null
    if (session.id !== sessionID) throw new Error("V1 session attribution mismatch")
    return { sessionID, worktree: actualDirectory(session.directory) }
  }
  const app = await bridge({ directory: input.directory, lookup, generate }, dependencies)
  try {
    const legacy = await (dependencies.loadLegacy ?? (() => import("./continuity.js")))()
    return {
      tool: { continuity: { ...legacy.default, execute: (args, context) => app.execute(args, context.sessionID) } },
      "chat.params": async ({ sessionID }, output) => {
        const request = owned.get(sessionID)
        if (!request) return
        if (!request.messagesCleared || !request.systemCleared || request.sent) {
          throw new Error("V1 distiller requires one sanitized, bounded model request")
        }
        output.maxOutputTokens = request.maxOutputTokens
        if (request.reasoning) output.options.reasoningEffort = request.reasoning
        request.sent = true
      },
      "experimental.chat.messages.transform": async (_, output) => {
        const sessionID = output.messages[0]?.info.sessionID
        const request = owned.get(sessionID)
        if (!request) return
        if (output.messages.some((message) => message.info.sessionID !== sessionID)) {
          throw new Error("V1 distiller message attribution mismatch")
        }
        const message = output.messages.find((message) => message.info.role === "user")
        const part = message?.parts.find((part) => part.type === "text" && !part.ignored && part.text === request.prompt)
        if (!part) throw new Error("V1 distiller submitted prompt is missing")
        output.messages.splice(0, output.messages.length, { info: message.info, parts: [part] })
        request.messagesCleared = true
      },
      "experimental.chat.system.transform": async ({ sessionID }, output) => {
        const request = owned.get(sessionID)
        if (!request) return
        output.system.length = 0
        // Count the complete sanitized input framing, not only deliberate source text.
        const serialized = JSON.stringify({ system: [], messages: [{ role: "user", content: [{ type: "text", text: request.prompt }] }], tools: [] })
        if (tokens(serialized) > 12000) throw new Error("V1 complete model input exceeds 12000 tokens including framing")
        request.systemCleared = true
      },
      event: async ({ event }) => {
        if (event.type === "session.status") {
          try { await app.observe(event.properties.sessionID, event.properties.status.type === "idle") }
          catch (error) {
            console.error(`[continuity] ${error.message}`)
            // A session whose lookup failed is gone; stop letting it hold its branch busy.
            if (error.message.includes("session.get(caller)")) app.forget(event.properties.sessionID)
          }
        }
      },
      dispose: async () => {
        closed = true; app.close()
        for (const controller of controllers) controller.abort()
        await Promise.allSettled(jobs)
      },
    }
  } catch (error) { app.close(); throw error }
}
