# Installed-fork continuity integration evidence

## Status (2026-11-07)

Checkpoint A is a **source preflight**, not live acceptance. Installed source, not newer web documentation, is authoritative. Both `MODIFICATIONS.md` files were read first. No OpenCode executable, CLI, server, TUI, provider request or production DB was launched/opened during this inspection. Only Bun version checks, source inspection and repository tests ran.

**Source gate resolved, live acceptance pending:** installed opf2x sessionless generation cannot enforce the requested output bound, but its native `session.generate` path can. On explicit parent authorization, the adapter now uses a fresh marked, wildcard-denied temporary session plus a session-ID-scoped `generate` hook (`options.maxTokens=4000`, empty tools, only the submitted prompt). This is an explicit deviation from plan §2's sessionless primitive, not a provider/model substitution. Actual configured model availability, credentials and both live acceptance rows remain unverified.

The startup map worked for this repository. Maps requested with external absolute paths incorrectly repeated this repository's outline; a subsequent broad AST search also failed (exit -1). Explicit-file structural searches and direct installed-source reads supplied the external evidence instead.

Source reference prefixes below:

| Prefix | Installed checkout | Inspected HEAD | Version source |
| --- | --- | --- | --- |
| V1 | `C:/Users/alvins/Documents/git/opencode-v1.18.5/` | `86dd82db01` | `packages/opencode/package.json:3`; root `package.json:7` pins Bun 1.3.14 |
| V2 | `C:/Users/alvins/Documents/git/opencode-v2.2.5/` | `72a9dea680` | `packages/cli/package.json:4`; root `package.json:8` pins Bun 1.4.4 |

`V1:path:line` / `V2:path:line` means that prefix plus the relative file path. Fork history/architecture: V1 `MODIFICATIONS.md:3-40`; V2 `MODIFICATIONS.md:3-64`. These are working-source observations, not a guarantee that an existing compiled executable contains the same commit.

## Baseline

Before concurrent implementation changes, ran from this repository:

```powershell
bun test tests/continuity.test.js --timeout 20000
```

Bun `1.3.14 (0d9b296a)`, exit **1**, 45 tests: **42 pass, 3 fail**, 173 expectations, 4.78 s. Failures were Windows path assumptions:

| Test | Original assertion | Expected / received |
| --- | --- | --- |
| falls back to current directory when missing/root-only | `tests/continuity.test.js:368` | `\tmp\continuity-cwd` / `C:\tmp\continuity-cwd` |
| resolves global and project config paths | `tests/continuity.test.js:379` | `/tmp/xdg-config/opencode/continuity.json` / `\tmp\xdg-config\opencode\continuity.json` |
| resolves configured directories relative to worktree/home | `tests/continuity.test.js:392` | `/tmp/project/.ai-memory` / `C:\tmp\project\.ai-memory` |

Those line references describe the original run; the parent session is concurrently editing the baseline suite. No fixes to that suite were made by this adapter task. Latest adapter check: `bun test tests/plugin.test.js --timeout 20000`: **20 pass, 0 fail**, 65 expectations (365 ms), including bounded V2 temporary-session generation and terminal execution events. Combined `bun test tests/plugin.test.js tests/runtime.test.js tests/scheduler.test.js --timeout 20000`: **33 pass, 0 fail**, 204 expectations (88.01 s). The diagnostic/assertion explicitly require `16000 total tokens (12000 input + 4000 output)`; the context check remains intact. Adapter syntax checks pass. An intermediate expanded-suite run failed an error-substring assertion and stalled on a Bun asynchronous assertion constructed before releasing the cancellation test; the shell timed out at 120 seconds. Corrected those test assertions and reran successfully. Mocks exercise the observed contracts, not a substitute for real model/tool-denial acceptance.

## DB isolation and launch prerequisites

Verified system Bun reports **1.3.14**; `C:/Users/alvins/.local/opt/bun-1.4.4/bun.exe --version` reports **1.4.4**. Use explicit source entrypoints and pinned toolchains for later tests, not the production `opf18` / `opf2x` functions.

- V1 `packages/core/src/database/database.ts:43-57`: `OPENCODE_DB` is checked first; absolute paths and `:memory:` pass through, relative names join `Global.Path.data`. Without it, `OPENCODE_DISABLE_CHANNEL_DB=1` reaches shared `opencode.db`.
- V2 actual current resolver is **`packages/cli/src/database-path.ts:4-12`**, not the outdated `Database.path()` description in the profile. `OPENCODE_DB` precedes channel selection; `path.resolve(data, filename)` handles absolute pins. `packages/cli/src/server-process.ts:114-116` passes this path into server creation. `packages/core/src/database/database.ts:67-78` opens that injected path and can migrate it.
- PowerShell profile `C:/Users/alvins/Documents/PowerShell/Microsoft.PowerShell_profile.ps1:26-60` saves/restores DB pins, uses `opencode-opf18.db` and `opencode-opf2x.db`, and passes caller directory; V2 uses `--standalone` and prefers `packages/cli/dist/cli-windows-x64/bin/opencode.exe`. These are **production pins, not integration DB names**. Never call these functions from the harness because they overwrite the test pin.
- Inspection environment inherited `OPENCODE_DB=opencode-opf2x.db`; `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` were unset. Never assume inherited env is isolated. Source inspection itself does not initialize either database.
- Later harness must allocate separate absolute temporary DB files beneath `C:/Users/alvins/AppData/Local/Temp/opencode/<test-owned-id>/`, separate config/data/state/cache roots, and test-owned worktrees. Assert normalized effective DB is exactly the allocated file, outside production data; reject every production/shared/snapshot DB. Pin child env before import/launch and restore it in `finally`.
- V1 source launch entry: Bun 1.3.14, `--cwd <V1>/packages/opencode --conditions=browser ./src/index.ts <actual-test-directory>`. V2: pinned Bun 1.4.4, `--cwd <V2>/packages/cli --conditions=browser ./src/index.ts --standalone <actual-test-directory>`. These are recipes only, **not executed**. No launch until pin/assertions and remaining adapter gates pass; the real acceptance matrix must use psmux.

## Global config directory (both installed runtimes)

Resolve `OPENCODE_CONFIG_DIR ?? join(XDG_CONFIG_HOME || join(os.homedir(), '.config'), 'opencode')`; append `continuity.jsonc` there. No project/CWD substitution. The root is frozen in the writer's persisted snapshot by the runtime, not reinterpreted by the generator.

- V1 `packages/core/src/global.ts:3-15,59-70`: XDG module constants plus `Global.make().config = Flag.OPENCODE_CONFIG_DIR ?? Path.config`. `Global.Path.config` alone does **not** apply the override. Installed dependency, resolved without importing Global: `node_modules/.bun/xdg-basedir@5.1.0/node_modules/xdg-basedir/index.js:4-16` uses the same XDG-or-home fallback on Windows.
- V2 `packages/util/src/global-roots.ts:4-17` implements XDG-or-home roots; `packages/util/src/global.ts:77-80` supplies `OPENCODE_CONFIG_DIR ?? Path.config`. `make()` alone uses `Path.config` unless injected.
- With the inspected unset overrides, both default to `C:/Users/alvins/.config/opencode`. Their implementations are distinct, even though these installations currently agree. Do not use `%APPDATA%`, `OPENCODE_TEST_HOME` (which only overrides `home`), the canonical Git root, or the CLI preference path as the server config root.

## Dual loader, registration, lifecycle

Default-only module: `{ id: 'opencode-continuity', server, setup }`. No eager cross-version SDK imports. V1 dynamically loads the legacy tool definition for its Zod args, replaces `execute`, and never invokes the standalone wrapper; V2 consumes `src/schema.js` JSON Schema directly.

- V1 `packages/opencode/src/plugin/shared.ts:272-303`: `readV1Plugin` reads `mod.default`, validates `server`, permits the extra `setup`, rejects simultaneous `server`/`tui`; file plugins require an ID (`:306-315`). `plugin/index.ts:112-122` invokes `.server(input, options)`, not `.setup`. `:141-166` injects the authenticated, instance-directory-scoped SDK client plus `directory`, `worktree`, `project`. No new SDK client is necessary.
- V1 `packages/plugin/src/index.ts:222-228`: return `{tool:{continuity: definition}, event, dispose}`. Tool shape is `description`, Zod raw `args`, async `execute(args, context)`; result string or `{output,title?,metadata?,attachments?}` (`packages/plugin/src/tool.ts:3-50`). `tool/registry.ts:122-151` supplies instance directory/worktree to custom tools; these are **not independently session-attributed**.
- V1 `plugin/index.ts:253-275`: event dispatch is scoped by `event.location.directory`, remaps data to `event.properties`, and invokes `dispose()` at finalization. Errors in the detached event callback are not automatically awaited by the host; adapter event failures must remain visible.
- V2 `packages/core/src/plugin/module.ts:75-88,169-186` accepts default `{id,setup}` (or `{id,effect}`), tolerating extra `server`; invokes Promise adapter for setup. V2 `MODIFICATIONS.md:44-54` explains the installed host-resolution fix and dual shims. Actual `packages/plugin/src/promise/adapter.ts:666-669` registers returned cleanup in the host scope.
- V2 `packages/plugin/src/promise/plugin.ts:27-66`: `ctx.location`, `ctx.session`, `ctx.model`, `ctx.tool`, `ctx.experimental.generate`; setup returns cleanup, not V1 Hooks.
- V2 `packages/plugin/src/promise/tool.ts:16-35,66-72`: `await ctx.tool.transform(editor => editor.add({name,description,input,execute}))`; returns registration with `.dispose()`. Executor receives `sessionID`, `signal`, etc., returns `{content: string}` or native content/metadata/output (`packages/schema/src/tool.ts:14-19,86-102`). No `args` or V1 `{output:string}` conversion is assumed.
- Registration cleanup: V2 explicitly disposes tool/hook registrations and closes scheduler; V1 closes scheduler, aborts owned generation controllers and waits for cleanup. Standalone/tool installation and plugin installation must be mutually exclusive (parent owns installation/export wiring).

## Physical session attribution and idle contracts

- V1 source schema: `packages/opencode/src/session/session.ts:226-245` has **`directory`**, `parentID`, `metadata`, singular `permission`. `:793-814` creates both primary/child sessions with `directory=InstanceState.context.directory`, not canonical `ctx.worktree`. `tool/task.ts:156-172` creates children with `parentID=calling sessionID`. `session/session.ts:666-670` fetches the persisted session by ID. Fetch every tool/event caller through the injected client: `client.session.get({path:{id:sessionID}})` returns `{data:session,error?}`. Use `data.directory`; refuse missing/mismatched identity rather than walking to a parent/canonical directory.
- V1 installed SDK `packages/sdk/js/src/client.ts:33-56` supplies directory/auth transport; GET requests rewrite directory header to query (`:17-30`). Generated V1 calls use `path.id`, whereas server route parameter is named `sessionID`; both address the same URL. No raw V2 client import in V1 is needed.
- V1 `packages/schema/src/session-status-event.ts:9-40`: `event.type='session.status'`, `properties={sessionID,status:{type:'idle'|'busy'|'retry',...}}`. Only `idle` is idle. Fetch the session before scheduling, skip `metadata.continuityDistiller` sessions, and never schedule the owned set.
- V2 `packages/schema/src/session.ts:32-63`: `parentID`, **`location: {directory, workspaceID?}`**, optional `subpath`, plural `permissions`. Location schema `packages/schema/src/location.ts:8-27` separates physical `directory` from `project.directory`/`project.canonical`. `ctx.session.get({sessionID})` returns a **bare session**, not `{data:session}` (`packages/client/src/effect/api/api.ts:168-170`; Promise adaptation `packages/plugin/src/promise/adapter.ts:266-281`). Use `session.location.directory`, never canonical project root or process CWD. Subagent calls carry the child ID; actual child creation uses `parentID=context.sessionID` (`packages/core/src/tool/plugin/subagent.ts:190-204`).
- V2 `packages/plugin/src/promise/session.ts:168-198`: `await ctx.session.hook('experimental.idle', ({sessionID,background})=>...)`; fires just before idle after successful model work, not after interruption/failure/control-only work. Nonempty background work defers local idleness. Use `prompt` hook to mark busy. Neither hook admits synthetic/user input. No V2 `session.status` assumption. Terminal coverage below prevents abandoned failed/interrupted contributors staying busy indefinitely.
- Startup is sessionless: `input.directory` (V1) / `ctx.location.directory` (V2) is authoritative for that plugin instance only. Resolve its scope, `remember(scope, undefined, true)` to resume persisted pending work. Tool calls use the fetched actual session directory and real sessionID. Idle checks refetch attribution, remember that scope and call scheduler status; no plugin-global last-active session.

## V1 generation: wildcard denial, explicit model, ownership

Concrete sequence (implemented, mock-tested; live malicious-tool acceptance pending):

1. `client.provider.list()` -> `{data:{all,connected,default}}`. Require configured provider in `connected`, configured model in `all[].models[modelID]`, `limit.context >= 16000`, sufficient input/output limits. Source generated catalog shape: `packages/sdk/js/src/gen/types.gen.ts:2977-3035`. Do not fall back to default.
2. `client.session.create({body:{title,metadata:{continuityDistiller:true},permission:[{permission:'*',pattern:'*',action:'deny'}],model:{providerID,modelID}}})`. Actual route accepts these fields: `server/routes/instance/httpapi/groups/session.ts:203-206`, `session/session.ts:262-271`. **Generated V1 create types are stale** (`packages/sdk/js/src/gen/types.gen.ts:2082-2092` only lists title/parentID); JS body transport and actual route schema are authoritative. No user session permissions are altered.
3. Put returned ID in the owned set immediately; `client.session.get({path:{id}})` must confirm marker and exact persisted wildcard rule **before first prompt/model request**. Refusal still aborts/deletes only that created ID.
4. `client.session.prompt({path:{id},body:{model:{providerID,modelID},tools:{'*':false},parts:[{type:'text',text:prompt}]},signal})`. `session/prompt.ts:1062-1072` translates wildcard tools false to the persisted rule before entering the model loop. `PromptInput` schema `:1502-1523`; generated request `sdk/js/src/gen/types.gen.ts:2588-2613`. Do not enumerate tools or use `tools:{}`.
5. Owned-session `chat.params` sets `maxOutputTokens`; source `packages/plugin/src/index.ts:247-256`, `session/llm/request.ts:114-132` proves the mutable parameter. Return concatenated text parts as the JSON string to the engine, reject missing text/provider error. Abort via `client.session.abort({path:{id}})` and delete via `.delete({path:{id}})` in `finally` on success/failure/cancellation.

Why no tool execution/permission prompt: `permission/index.ts:28-37` wildcard matching is last-match-wins; `:204-218` computes disabled tools over **the current map**, normalizing edit/read aliases. `session/llm/request.ts:208-214` filters the complete prepared map with agent rules followed by session wildcard denial on each request. `session/tools.ts:92-134` adds built-in/custom tools and later MCP resource/tool maps before preparation. A later-registered name is still matched by `*`; no allowlist snapshot is used. Denied tools are absent even if they never call `ctx.ask` themselves.

Important distinction: `permission/index.ts:67-100` rejects deny before emitting `Asked`, **but instance remembered approvals are appended after supplied rules**. The evaluator alone is not a comprehensive deny guarantee. The decisive no-tools boundary is final prepared-map filtering, which does not append remembered approvals. Workflow-provider special handling (`session/llm.ts:119-205`) is not accepted as verified arbitrary-provider denial; live acceptance must use the exact configured provider and attempt built-in/custom/MCP/later tools, asserting zero tool execution and zero `Asked` events. Any host/plugin that mutates the final denied map outside these contracts invalidates this preflight.

## V2 model identity and bounded native auxiliary generation

Actual callable shape is:

```js
await ctx.experimental.generate.text({
  prompt,
  model: { providerID: 'zai-coding-plan', id: 'glm-5.3-flash' },
}) // -> { text: string }, NOT a string directly
```

This sessionless recipe is **not used**: the output bound cannot be supplied to it. The authorized alternative below removes the source blocker without editing fork/provider configuration.

- `packages/client/src/effect/api/api.ts:1483-1487`: only `prompt` and optional `model`; response `{text}`. Promise domain references the same generated client (`packages/client/src/promise/api.ts:14-15`). No `signal`, `maxOutputTokens`, `tools`, or `sessionID` field.
- **Correction to plan §2:** `Model.Ref` is `{providerID,id,variant?}`, not `{providerID,modelID}` (`packages/schema/src/model.ts:19-44`). `modelID` is present elsewhere in model catalogs/editor helpers, but not this request ref. Preserve catalog `id` rather than provider API modelID.
- `ctx.model.list({types:['chat']})` -> `{location,data:Model.Info[]}` (`packages/client/src/effect/api/api.ts:1467-1480`). Match providerID + id and enabled status; check `limit.context >=16000`, `limit.output >=4000`, `limit.input >=12000` if supplied (`packages/schema/src/model.ts:114-137`). Catalog membership is not proof credentials work.
- Explicit resolution: `packages/core/src/model-resolver.ts:453-490,505-520` resolves the selected provider's active integration/credentials, loads its package and returns catalog ref/limits. Explicit requested ref uses `models.get(providerID,id)`; only an omitted model permits default selection/fallback. `packages/core/src/generate.ts:92-128` fails missing explicit model instead of choosing another and calls `llm.generate(ai.request({model:resolved.model,prompt,http:...}))`. It creates only an attribution header ID, no stored session/history/tool registry/executor; this proves the no-tools path.
- Sessionless limitation: that same call never passes `resolved.limit`, output settings or request cancellation into `ai.request`. `Generate.TextInput` at `:16-19` exposes no override. Catalog output capacity is not an enforced 4000-token ceiling. Session request hooks cannot affect that sessionless path. No invented max-token argument, prompt-only bound, global model mutation or direct credential/provider API is used.

### Implemented alternative (explicit plan deviation)

1. Check the enabled native model catalog and limits as above. `ctx.session.create({location:{directory:ctx.location.directory},model:{providerID,id},title,metadata:{continuityDistiller:true},permissions:[{action:'*',resource:'*',effect:'deny'}]})` returns a bare fresh session. No parentID or caller-supplied ID, hence no reused user session/history. API fields: `packages/client/src/effect/api/api.ts:152-162`; implementation `packages/core/src/session.ts:288-338` persists the explicit model/location/permissions/marker before returning. It performs no model request. Immediately record the returned ID as owned, refetch it, and verify persisted identity, marker, model, physical location, no parent and exact wildcard denial before generating.
2. Register `await ctx.session.hook('generate', event => {...})`; Promise hook mutation is passed directly to the host (`packages/plugin/src/promise/adapter.ts:622-634`). Exact event schema `packages/plugin/src/promise/session.ts:22-40,55,185-190` includes `sessionID`, `model`, mutable `system`, `messages`, `tools`, `options`. Match **only the owned ID** and assert selected providerID/id. Set `event.options={maxTokens:4000}`, `event.tools={}`, `event.system=[]`, and `event.messages=[{role:'user',content:[{type:'text',text:capturedPrompt}]}]`. Other sessions are untouched. Clearing inherited system/history/instruction material is intentional: only engine-budgeted deliberate sources belong in this request.
3. Call `ctx.session.generate({sessionID:ownedID,prompt})` -> `{text:string}` (`packages/client/src/effect/api/api.ts:323-327`; `packages/core/src/session.ts:482-488`). It is **auxiliary generation**, not `session.prompt`, synthetic input or a user turn. Source `packages/core/src/session/generate.ts:25-68` previews context, fires `context.request.generate`, invokes `llm.generate` once (with provider retry), returns text and does not mutate transcript or enter the tool-execution runner. Its context initially includes instructions/tools, so the hook explicitly removes those rather than assuming the sessionful contract is tool-free.
4. Bound reaches actual request: `packages/core/src/session/model-request.ts:242-315` shapes the draft, invokes the hook (`:422-429`), separates generation keys (`:287-289`) and passes `generation` to `ai.request` (`:313`). `GenerationOptions.fields.maxTokens` is real (`packages/ai/src/schema/options.ts:115-139`). `packages/ai/src/llm.ts:127-150` normalizes plain hook message records via `Message.make` and options via `GenerationOptions.make`; no runtime SDK imports are needed. `packages/ai/src/protocols/anthropic-messages.ts:1066,1092-1100` lowers it to `max_tokens`; Z.AI messages uses that body lowering (`packages/ai/src/protocols/zai-messages.ts:20-28`). Actual configured model route/capabilities still require live inspection.
5. No-tool boundary: the hook gives the preparation stage zero tools; `session/model-request.ts:280-285,311` maps only those surviving definitions, so late/custom/MCP tools are absent too. Auxiliary generation does not invoke `prepared.executeTool`; only `llm.generate(prepared.request,prepared.options)` is called (`session/generate.ts:64`). Session wildcard permissions additionally narrow snapshot/discovery (`session/context.ts:126-165`). There is no tool callback or permission-asking loop in this generation path. Do not describe it as inherently tool-free without this hook.
6. Model selection is explicit and cannot fall back: `packages/core/src/session/runner/model.ts:77-98` resolves an existing `session.model` only against the available catalog and fails missing refs. The hook checks the final resolved model too. Nonempty response text is returned unchanged to the engine's JSON validation. Failed readback/hook/provider/cleanup leaves engine sources pending.
7. Cancellation: AbortSignal listener rejects a Promise race promptly, calls `ctx.session.interrupt({sessionID:ownedID,resume:false})`, then `ctx.session.remove({sessionID:ownedID})` in `finally`. API shapes `packages/client/src/effect/api/api.ts:172-174,329-333`; actual remove interrupts/waits for coordinated execution, cancels jobs, then deletes (`packages/core/src/session.ts:391-401`). A standalone auxiliary request is not guaranteed to belong to the execution coordinator: provider work/charges can continue despite interrupt/remove. The aborted race plus post-response signal check never returns its late text, and the engine fences late commits. Dispose the per-job hook, remove ownership, close all owned controllers/jobs on unload. No user sessions are interrupted/deleted.

### Authoritative terminal execution coverage (no polling)

- `ctx.event.subscribe({types:[...],signal})` is the actual async-iterable API (`packages/plugin/src/promise/event.ts:6-9`; `packages/client/src/shared-events.ts:10-15`). Native payload is `{type,data:{sessionID,...},...}`, not V1 `properties` (`packages/protocol/src/groups/event.ts:23-36`). Subscribe once to `session.execution.started`, `.succeeded`, `.failed`, `.interrupted`, and `session.deleted`.
- Definitions: `packages/schema/src/session-event.ts:182-189,244-263`. These are whole-execution events, **not step/tool completions**. Coordinator emits exactly one terminal observation per busy period, including errors/interruption (`packages/core/src/session/execution.ts:109-145`). Projector records busy on Started and idle on all three terminal outcomes (`session/projector.ts:790-800`). Thus interruption/failure need not wait for the success-only `experimental.idle` hook.
- Started marks a fetched, already-known contributor busy; terminal events refetch its actual session then mark idle. Ignore IDs absent from the adapter's per-session attribution map: the native bus subscription is server-wide (`packages/core/src/plugin/host.ts:266-282`), not automatically location-filtered. Refuse to clear busy if persisted `time.busy > time.idle`, indicating a newer active execution. Known background work remains busy even on execution success. Owned/marked distiller sessions are excluded.
- Deleted arrives only after interrupt/awaitIdle/cancel (`session.ts:391-401`). Its row may already be gone. Release that contributor using **its own previously fetched physical attribution**, stored by sessionID; never guess a parent/CWD/canonical root. Unknown deleted sessions have no cached contribution and do nothing.
- This stream is volatile and can overflow/disconnect (`packages/protocol/src/groups/event.ts:68-69`). On stream failure/end, report visibly and close the scheduler/generator (reload required) rather than invent idle state, poll, or silently continue with stale busy/idle knowledge. Unload aborts subscription and awaits its loop. No subagent progress polling is used.

## Remaining acceptance checklist

- [x] Resolve V2 source-level output/cancellation gate using explicitly authorized native auxiliary generation; mock tests cover scoped hard bound, no tools/context, model mapping, ownership readback, failure/cancellation/late result, cleanup and terminal events.
- [ ] Parent owns runtime/scheduler correctness, package exports, installation mutual exclusion and wiring; this task edits only adapters, adapter tests and this evidence file.
- [ ] Validate actual test-owned effective DB/config roots and exact executable/source revision before any live launch.
- [ ] Verify configured model credentials/catalog/limits in isolated instances without exposing secrets; no model substitution.
- [ ] Run both real psmux matrix rows from plan §11, including linked-worktree primary/subagents, tool denial/late registration/no prompts, automatic/manual scheduling and cleanup; retain sanitized pane/log/artifact evidence.

Skipped: production launches, paid generation and live acceptance. Risk: source/mocks do not establish provider access or runtime acceptance; cancellation may not prevent a charge, and native event-stream loss requires plugin reload.
