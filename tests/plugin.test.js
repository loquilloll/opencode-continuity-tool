import { describe, it, expect } from "bun:test"
import path from "node:path"
import plugin, { checkLimits, globalConfigRoot } from "../src/plugin.js"
import { server } from "../src/plugin-v1.js"
import { setup, generator } from "../src/plugin-v2.js"

const directory = path.resolve("test-checkout")
it("requires output headroom when reasoning is configured", () => {
  const model = { limit: { context: 16000, output: 4000 } }
  expect(checkLimits(model, 8000)).toBe(4000)
  expect(() => checkLimits(model, 8000, { reasoning: "low" })).toThrow("output limit")
  expect(checkLimits({ limit: { context: 16000, output: 8000 } }, 8000, { reasoning: "low" })).toBe(8000)
})
function dependencies() {
  const events = []
  let generate
  return {
    events,
    get generate() { return generate },
    continuityScope: async (_, context) => ({ workspace: context.worktree, storeId: "store", branchKey: "branch" }),
    executeContinuity: async (args, context, options) => {
      events.push(["execute", args, context, options.globalConfigRoot])
      if (args.command === "distill") return options.generate({ prompt: "quoted sources", model: "provider/model", maxOutputTokens: 4000 })
      return "ok"
    },
    createScheduler: (options) => {
      generate = options.generate
      return {
        remember: async (...args) => events.push(["remember", ...args]),
        status: async (...args) => events.push(["status", ...args]),
        forget: (id) => events.push(["forget", id]),
        close: () => events.push(["close"]),
      }
    },
    loadLegacy: async () => ({ default: { args: { command: "legacy Zod shape" }, description: "continuity", execute: () => { throw new Error("standalone must not run") } } }),
  }
}

function v1() {
  const calls = []
  const sessions = new Map([["child", { id: "child", parentID: "parent", directory }]])
  const ok = (value) => Promise.resolve({ data: value })
  const client = {
    provider: { list: () => ok({ connected: ["provider"], all: [{ id: "provider", models: { model: { limit: { context: 16000, output: 4000 } } } }] }) },
    session: {
      get: ({ path: { id } }) => ok(sessions.get(id)),
      create: ({ body }) => {
        calls.push(["create", body])
        const session = { id: "owned", directory, ...body }
        sessions.set("owned", session)
        return ok(session)
      },
      // A model-returned tool-call part must never execute or leak into the distilled text.
      prompt: (request) => { calls.push(["prompt", request]); return ok({ info: {}, parts: [{ type: "tool", tool: "shell", state: { input: { command: "rm -rf /" } } }, { type: "text", text: '{"checkpoint":"done"}' }] }) },
      abort: ({ path: { id } }) => { calls.push(["abort", id]); return ok(true) },
      delete: ({ path: { id } }) => { calls.push(["delete", id]); return ok(true) },
    },
  }
  return { client, calls, sessions }
}

function v2() {
  const hooks = {}
  const tools = []
  const disposed = []
  const calls = []
  const sessions = new Map()
  let deliver, acknowledged
  const event = {
    subscribe: ({ signal }) => {
      signal.addEventListener("abort", () => deliver?.({ done: true }), { once: true })
      return {
        [Symbol.asyncIterator]() { return this },
        next() {
          acknowledged?.(); acknowledged = undefined
          return new Promise((resolve) => { deliver = resolve })
        },
      }
    },
  }
  const register = (name) => ({ dispose: async () => disposed.push(name) })
  return {
    hooks, tools, disposed, calls, sessions, event,
    emit: (event) => new Promise((resolve) => { acknowledged = resolve; deliver({ value: event, done: false }) }),
    location: { directory, project: { canonical: path.resolve("wrong-canonical") } },
    tool: { transform: async (callback) => { callback({ add: (tool) => tools.push(tool) }); return register("tool") } },
    session: {
      get: async ({ sessionID }) => sessions.get(sessionID) ?? ({ id: sessionID, parentID: "parent", location: { directory }, time: { busy: 1, idle: 2 } }),
      create: async (request) => { calls.push(["create", request]); const session = { id: "owned-v2", ...request }; sessions.set(session.id, session); return session },
      generate: async (request) => {
        calls.push(["generate", request])
        const event = { sessionID: request.sessionID, model: sessions.get(request.sessionID).model,
          system: [{ type: "text", text: "unrelated instructions" }], messages: [{ role: "assistant", content: [] }],
          tools: { shell: {}, custom: {}, mcp_remote: {}, registered_later: {} }, options: { temperature: 1 } }
        await hooks.generate(event)
        calls.push(["prepared", event])
        return { text: '{"checkpoint":"done"}' }
      },
      interrupt: async (request) => { calls.push(["interrupt", request]); return { interrupted: false } },
      remove: async (request) => { calls.push(["remove", request]) },
      hook: async (name, callback) => { hooks[name] = callback; return register(name) },
    },
    model: { list: async () => ({ location: { directory }, data: [{ id: "model", providerID: "provider", enabled: true, limit: { context: 16000, output: 4000 } }] }) },
    experimental: { generate: { text: async () => { throw new Error("unbounded paid call must not happen") } } },
  }
}

describe("installed-host continuity adapters", () => {
  it("exports only the dual loader default shape, with no eager SDK import", () => {
    expect(Object.keys(plugin)).toEqual(["id", "server", "setup"])
  })
  it("resolves override and XDG roots without project/cwd substitution", () => {
    expect(globalConfigRoot({ OPENCODE_CONFIG_DIR: directory }, "ignored")).toBe(directory)
    expect(globalConfigRoot({ XDG_CONFIG_HOME: directory }, "ignored")).toBe(path.join(directory, "opencode"))
  })
  it("V1 uses actual child session directory, not project worktree or standalone", async () => {
    const host = v1(), deps = dependencies()
    const hooks = await server({ ...host, directory, worktree: path.resolve("wrong") }, deps)
    expect(deps.events[0]).toEqual(["remember", expect.anything(), undefined, true])
    expect(await hooks.tool.continuity.execute({ command: "read" }, { sessionID: "child" })).toBe("ok")
    expect(deps.events.find((event) => event[0] === "execute")[2]).toEqual({ sessionID: "child", worktree: directory })
    await hooks.dispose()
  })
  it("V1 persists wildcard deny before first prompt, maps explicit model and cleans only owned session", async () => {
    const host = v1(), deps = dependencies()
    const hooks = await server({ ...host, directory }, deps)
    const originalPrompt = host.client.session.prompt
    host.client.session.prompt = async (request) => {
      // Verified host order: messages.transform -> system.transform -> chat.params (prompt.ts:1258, request.ts:70/115).
      await hooks["experimental.chat.messages.transform"](null, { messages: [
        { info: { sessionID: "owned", role: "user" }, parts: [
          { type: "text", text: request.body.parts[0].text },
          { type: "text", text: "injected attachment", ignored: true },
        ] },
      ] })
      await hooks["experimental.chat.system.transform"]({ sessionID: "owned" }, { system: [{ type: "text", text: "unrelated inherited instructions" }] })
      const output = { options: {} }
      await hooks["chat.params"]({ sessionID: "owned" }, output)
      expect(output.maxOutputTokens).toBe(4000)
      expect(output.options.reasoningEffort).toBe("low")
      await expect(hooks["chat.params"]({ sessionID: "owned" }, {})).rejects.toThrow("sanitized")
      await hooks.event({ event: { type: "session.status", properties: { sessionID: "owned", status: { type: "idle" } } } })
      expect(deps.events.some((event) => event[0] === "status")).toBe(false)
      return originalPrompt(request)
    }
    expect(await deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000, reasoning: "low" })).toBe('{"checkpoint":"done"}')
    expect(host.calls[0][1].permission).toEqual([{ permission: "*", pattern: "*", action: "deny" }])
    expect(host.calls[1][1].body.tools).toEqual({ "*": false })
    expect(host.calls[1][1].body.model).toEqual({ providerID: "provider", modelID: "model" })
    expect(host.calls.some(([name]) => name === "abort")).toBe(false)
    expect(host.calls.at(-1)).toEqual(["delete", "owned"])
    await hooks.dispose()
  })
  it("V1 refuses unconfirmed denial with no prompt, including late tools rather than an enumeration", async () => {
    const host = v1(), deps = dependencies()
    const get = host.client.session.get
    host.client.session.get = async (request) => {
      const response = await get(request)
      if (request.path.id === "owned") response.data = { ...response.data, permission: [{ permission: "read", pattern: "*", action: "deny" }] }
      return response
    }
    const hooks = await server({ ...host, directory }, deps)
    await expect(deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("wildcard denial")
    expect(host.calls.some(([name]) => name === "prompt")).toBe(false)
    expect(host.calls.at(-1)).toEqual(["delete", "owned"])
    await hooks.dispose()
  })
  it("V1 aborts and deletes owned sessions after provider failure", async () => {
    const host = v1(), deps = dependencies()
    host.client.session.prompt = async () => { throw new Error("provider failed") }
    const hooks = await server({ ...host, directory }, deps)
    await expect(deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("provider failed")
    expect(host.calls.slice(-2)).toEqual([["abort", "owned"], ["delete", "owned"]])
    await hooks.dispose()
  })
  it("V1 cancellation sends abort and still deletes", async () => {
    const host = v1(), deps = dependencies(), controller = new AbortController()
    host.client.session.prompt = async () => { controller.abort(); throw new Error("cancelled") }
    const hooks = await server({ ...host, directory }, deps)
    await expect(deps.generate({ prompt: "data", model: "provider/model", signal: controller.signal, maxOutputTokens: 4000 })).rejects.toThrow()
    expect(host.calls.slice(-2)).toEqual([["abort", "owned"], ["delete", "owned"]])
    await hooks.dispose()
  })
  it("V1 refuses missing attribution even when plugin/canonical directory exists", async () => {
    const host = v1(), deps = dependencies()
    delete host.sessions.get("child").directory
    const hooks = await server({ ...host, directory }, deps)
    await expect(hooks.tool.continuity.execute({ command: "read" }, { sessionID: "child" })).rejects.toThrow("authoritative")
    await hooks.dispose()
  })
  it("V1 loads the real legacy Zod args without invoking standalone execution", async () => {
    const host = v1(), deps = dependencies()
    delete deps.loadLegacy
    const hooks = await server({ ...host, directory }, deps)
    expect(hooks.tool.continuity.args.command.parse("distill")).toBe("distill")
    expect(await hooks.tool.continuity.execute({ command: "read" }, { sessionID: "child" })).toBe("ok")
    await hooks.dispose()
  })
  it("V1 refuses insufficient catalog context before creating a session", async () => {
    const host = v1(), deps = dependencies()
    host.client.provider.list = async () => ({ data: { connected: ["provider"], all: [{ id: "provider", models: { model: { limit: { context: 15000, output: 4000 } } } }] } })
    const hooks = await server({ ...host, directory }, deps)
    await expect(deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("16000 total tokens")
    expect(host.calls).toEqual([])
    await hooks.dispose()
  })
  it("V1 disposal cancels and awaits owned work without touching user sessions", async () => {
    const host = v1(), deps = dependencies()
    let started
    const ready = new Promise((resolve) => { started = resolve })
    host.client.session.prompt = ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("disposed")), { once: true })
      started()
    })
    const hooks = await server({ ...host, directory }, deps)
    const job = deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })
    const rejected = job.catch((error) => error)
    await ready
    await hooks.dispose()
    expect((await rejected).message).toBe("disposed")
    expect(host.calls.slice(-2)).toEqual([["abort", "owned"], ["delete", "owned"]])
  })
  it("V2 registers native schema/result, tracks real child identity and disposes hooks", async () => {
    const host = v2(), deps = dependencies()
    const close = await setup(host, deps)
    expect(host.tools[0].input.type).toBe("object")
    expect(await host.tools[0].execute({ command: "read" }, { sessionID: "child" })).toEqual({ content: "ok" })
    await host.hooks["experimental.idle"]({ sessionID: "child", background: [] })
    expect(deps.events.at(-1)).toEqual(["status", "child", true])
    await host.hooks.prompt({ sessionID: "child" })
    expect(deps.events.at(-1)).toEqual(["status", "child", false])
    await close()
    expect(host.disposed).toEqual(["tool", "prompt", "experimental.idle"])
  })
  it("V2 rejects absent physical location rather than canonical/project/cwd", async () => {
    const host = v2(), deps = dependencies()
    const close = await setup(host, deps)
    host.session.get = async ({ sessionID }) => ({ id: sessionID, location: {} })
    await expect(host.tools[0].execute({ command: "read" }, { sessionID: "child" })).rejects.toThrow("authoritative")
    await close()
    host.location = { project: { canonical: directory } }
    await expect(setup(host, dependencies())).rejects.toThrow("authoritative")
  })
  it("V2 uses fresh native generate with explicit model, wildcard denial, bounded options and no tools/context", async () => {
    const host = v2()
    const generate = generator(host)
    expect(await generate({ prompt: "quoted sources", model: "provider/model", maxOutputTokens: 4000, reasoning: "low" })).toBe('{"checkpoint":"done"}')
    expect(host.calls[0][1]).toEqual({ title: "[continuity distiller]", location: { directory },
      model: { providerID: "provider", id: "model" }, metadata: { continuityDistiller: true },
      permissions: [{ action: "*", resource: "*", effect: "deny" }] })
    expect(host.calls[1]).toEqual(["generate", { sessionID: "owned-v2", prompt: "quoted sources" }])
    const prepared = host.calls[2][1]
    expect(prepared.options).toEqual({ maxTokens: 4000, reasoningEffort: "low" })
    expect(prepared.tools).toEqual({})
    expect(prepared.system).toEqual([])
    expect(prepared.messages).toEqual([{ role: "user", content: [{ type: "text", text: "quoted sources" }] }])
    expect(host.calls.slice(-2)).toEqual([["interrupt", { sessionID: "owned-v2", resume: false }], ["remove", { sessionID: "owned-v2" }]])
    expect(host.disposed).toEqual(["generate"])
    const foreign = { sessionID: "user-session", options: { maxTokens: 123 } }
    await host.hooks.generate(foreign)
    expect(foreign.options.maxTokens).toBe(123)
    await generate.close()
  })
  it("V2 checks catalog before session creation and refuses unconfirmed denial before generation", async () => {
    const host = v2()
    const generate = generator(host)
    host.model.list = async () => ({ data: [] })
    await expect(generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("unavailable")
    expect(host.calls).toEqual([])
    const deniedHost = v2()
    deniedHost.session.get = async () => ({ ...deniedHost.sessions.get("owned-v2"), permissions: [] })
    const denied = generator(deniedHost)
    await expect(denied({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("wildcard denial")
    expect(deniedHost.calls.some(([name]) => name === "generate")).toBe(false)
    expect(deniedHost.calls.at(-1)).toEqual(["remove", { sessionID: "owned-v2" }])
    await generate.close(); await denied.close()
  })
  it("V2 rejects late provider results after cancellation and cleans only owned resources", async () => {
    const host = v2(), controller = new AbortController()
    let started, finish
    const ready = new Promise((resolve) => { started = resolve })
    host.session.generate = async () => { started(); return new Promise((resolve) => { finish = resolve }) }
    const generate = generator(host)
    const result = generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000, signal: controller.signal }).catch((error) => error)
    await ready
    controller.abort(new Error("cancelled test"))
    expect((await result).message).toBe("cancelled test")
    finish({ text: "late result must not commit" })
    expect(host.calls.slice(-2)).toEqual([["interrupt", { sessionID: "owned-v2", resume: false }], ["remove", { sessionID: "owned-v2" }]])
    await generate.close()
  })
  it("V2 excludes temporary sessions from scheduling and awaits cleanup on unload", async () => {
    const host = v2(), deps = dependencies()
    let started
    const ready = new Promise((resolve) => { started = resolve })
    host.session.generate = async ({ sessionID }) => {
      await host.hooks.prompt({ sessionID })
      await host.hooks["experimental.idle"]({ sessionID, background: [] })
      started()
      return new Promise(() => {})
    }
    const close = await setup(host, deps)
    const result = deps.generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 }).catch((error) => error)
    await ready
    expect(deps.events.some(([name]) => name === "status")).toBe(false)
    await close()
    expect(await result).toBeInstanceOf(Error)
    expect(host.calls.at(-1)).toEqual(["remove", { sessionID: "owned-v2" }])
  })
  it("V2 cleans temporary session and hook on provider failure", async () => {
    const host = v2(), generate = generator(host)
    host.session.generate = async () => { throw new Error("V2 provider failed") }
    await expect(generate({ prompt: "data", model: "provider/model", maxOutputTokens: 4000 })).rejects.toThrow("V2 provider failed")
    expect(host.calls.at(-1)).toEqual(["remove", { sessionID: "owned-v2" }])
    expect(host.disposed).toEqual(["generate"])
    await generate.close()
  })
  it("V2 terminal execution events clear failed/interrupted contributors but not a newer active execution", async () => {
    const host = v2(), deps = dependencies()
    const close = await setup(host, deps)
    const startup = deps.events.length
    await host.emit({ type: "session.execution.started", data: { sessionID: "unrelated-session" } })
    expect(deps.events.length).toBe(startup)
    await host.hooks.prompt({ sessionID: "child" })
    await host.emit({ type: "session.execution.failed", data: { sessionID: "child", error: {} } })
    expect(deps.events.at(-1)).toEqual(["status", "child", true])
    await host.emit({ type: "session.execution.started", data: { sessionID: "child" } })
    expect(deps.events.at(-1)).toEqual(["status", "child", false])
    await host.emit({ type: "session.execution.interrupted", data: { sessionID: "child", reason: "user" } })
    expect(deps.events.at(-1)).toEqual(["status", "child", true])
    host.sessions.set("child", { id: "child", location: { directory }, time: { busy: 10, idle: 2 } })
    await host.hooks.prompt({ sessionID: "child" })
    const before = deps.events.length
    await host.emit({ type: "session.execution.failed", data: { sessionID: "child", error: {} } })
    expect(deps.events.length).toBe(before)
    expect(deps.events.at(-1)).toEqual(["status", "child", false])
    await close()
  })
  it("V2 deletion releases only the cached physical attribution and terminal success respects background work", async () => {
    const host = v2(), deps = dependencies()
    const close = await setup(host, deps)
    await host.hooks.prompt({ sessionID: "child" })
    await host.hooks["experimental.idle"]({ sessionID: "child", background: [{ kind: "shell" }] })
    const before = deps.events.length
    await host.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } })
    expect(deps.events.length).toBe(before)
    host.session.get = async () => { throw new Error("deleted session must not be fetched") }
    await host.emit({ type: "session.deleted", data: { sessionID: "child" } })
    expect(deps.events.at(-2)).toEqual(["status", "child", true])
    expect(deps.events.at(-1)).toEqual(["forget", "child"])
    await close()
  })
})
