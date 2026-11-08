# Branch-isolated continuity with automatic distillation

## 1. Outcome and boundaries

Implement branch-scoped continuity shared by primary agents and subagents, with durable, automatic distillation of **deliberately submitted continuity entries only** into repository-wide knowledge. Markdown remains human-readable and uncommitted. Support both installed forks: opf18 v1.18.5 and opf2x v2.2.5. This document is the complete implementation specification; no historical draft is required.

Do not harvest transcripts, inject full memory into prompts, send unsolicited user turns, add messaging/vectors/Obsidian/Git hooks, prune history, or edit production fork/global configuration. Standalone custom-tool use continues to work, but automatic generation requires plugin installation. This is a plan, not evidence that runtime contracts or acceptance checks have passed.

## 2. Mandatory preflight gates

Before implementation, inspect these installed sources and record the exact symbols, field shapes, permission semantics, runtime versions, and line references in the integration evidence:

| Runtime | Authoritative source starting points | Intended adapter |
| --- | --- | --- |
| opf18, `C:/Users/alvins/Documents/git/opencode-v1.18.5` | `packages/opencode/src/plugin/index.ts` (`applyPlugin`, scoped dispatch), `plugin/shared.ts` (`readV1Plugin`), `session/prompt.ts` (`PromptInput`, permissions), `server/routes/instance/httpapi/groups/session.ts`, `packages/sdk/js/src/gen/types.gen.ts`, `client.ts`, `packages/schema/src/session-status-event.ts` | V1 tool map; `session.status` idle; owned temporary generation session |
| opf2x, `C:/Users/alvins/Documents/git/opencode-v2.2.5` | `packages/core/src/plugin/module.ts`, `plugin/host.ts`, `session/runner/llm.ts`, `packages/plugin/src/promise/session.ts`, `promise/plugin.ts`, `packages/client/src/effect/api/api.ts` | `ctx.tool.transform`; `experimental.idle`; isolated temporary-session `ctx.session.generate` with scoped request hook; model `{ providerID, id }` |

Verify, rather than assume:

- Dual default-only `{ id, server, setup }` loading, exports/module format, SDK availability, disposal, and actual tool registration contracts. Avoid eager imports of an SDK unavailable in the other runtime.
- Authoritative physical session-directory fields for primary agents and subagents in linked worktrees, parent/session lookup behavior, and sessionless calls. Neither canonical project root nor process CWD is a substitute for missing session attribution.
- Each runtime's actual global config-root resolver, including `OPENCODE_CONFIG_DIR` and XDG behavior. Their global roots may differ.
- V1 can establish wildcard-deny **before the first request**, covering built-ins, custom tools, MCP, and tools registered later. Verify the evaluator, not an enumeration of today's tools. Never alter a user's permissions. Exclude marked distiller sessions from scheduling before prompting; interrupt/delete only owned temporary sessions. No reusable permissive session.
- V2 auxiliary generation permits no tool execution: use a fresh wildcard-denied temporary session and a scoped `generate` hook that clears inherited system/messages/tools and enforces `maxTokens`. Remove the owned session afterward. The installed sessionless API has no hard output control and must not be used. Verify model context/output limits and configured provider/model availability.
- Correct executable/Bun versions and effective `OPENCODE_DB` pinning for both installed runtimes before any live launch.

Unknown fields or permission capabilities are **blocking preflight gates**, not independently verified facts. If attribution, comprehensive denial, config-root resolution, or DB isolation cannot be established, stop the affected adapter/live acceptance and report the blocker; do not substitute a permissive implementation or production database.

## 3. Scope, identity, and storage

Resolve the physical calling session's checkout, `git-common-dir`, and full symbolic branch on every operation. Capture scope and provenance when writing; never use a plugin-global last-active session. A checkout switch must affect subsequent calls without reattributing old entries. Ambiguous attribution fails visibly. Git errors in an identified repo do not silently become non-Git mode.

Store beneath `<git-common-dir>/opencode-continuity/`:

```text
shared.md                              # stable shared IDs, assertions, provenance
branches/<readable-prefix>-<sha256-full-branch-name>/
  CONTINUITY.md                        # deliberate source journal
  MEMORY.md                            # rollover sources, not a generated summary
  checkpoint.md                        # replaceable branch summary
  conflicts.md                         # durable append/update-by-ID conflict records
  state.json                           # revisions, reviewed hashes, epochs, claims/status
legacy/<content-hash>/...               # original bytes plus import manifest
history/...                            # prior revisions and transaction recovery evidence
transactions/...                       # recoverable multi-file transaction records
```

Use an explicit namespace discriminator for symbolic branches versus detached full-commit IDs. Unborn branches use the symbolic name. Preserve full-name identity despite slashes, case differences, and sanitized prefix collisions. Non-Git workspaces use an explicit directory-local store and scope. Deleted branches retain all data; name reuse resumes it. Renames start a new namespace; document stopped-runtime manual recovery without automatic merging. No new ignore rules are needed for Git-common-dir storage; it is not pushed/cloned and needs backup.

Primary/subagent sessions in the same full branch share the entire branch scope, even across checkouts. Shared knowledge is repository-wide. Optional branch selection permits intentional reads only, never a path or cross-branch write. Retain entry IDs/hash validation, sections, rollover/archive evidence, and named legacy test exports. Read-ledger identity is store + branch + session, with distinct shared/source identities; old ledger identities cause a documented one-time replay.

### Legacy import

On first access to each physical checkout/configured legacy directory, automatically copy existing `CONTINUITY.md` and `MEMORY.md` byte-for-byte into content-addressed, unscoped `legacy/` archives. Include original path, bytes hash, and import time in the manifest. Preserve originals; do not move, rewrite, inject, or automatically promote mixed legacy history. Mark import complete only after durable copy/manifest commit; retry safely after crashes. In Git repositories old `directory` settings identify import sources only, never disable branch isolation. Changed legacy bytes form another archive version.

## 4. Configuration and epoch ownership

Read global OpenCode config-folder `continuity.jsonc`, then override **per field**, including nested fields, with `<physical-workspace-root>/.opencode/continuity.jsonc`. Omitted fields inherit. Do not embed settings in `opencode.json(c)`.

```jsonc
{
  "distillation": {
    "model": "zai-coding-plan/glm-5.3-flash",
    "intervalHours": 2.5
  }
}
```

Validate nonempty provider/model and finite positive fractional interval; report unknown/invalid fields with filenames. Use an existing suitable JSONC parser, not regex comment removal. At each config location, legacy directory-only `continuity.json` is fallback only when JSONC is absent. Malformed JSONC is an error, not fallback. No model fallback. Default 2.5 hours yields roughly three runs in eight continuously dirty, idle working hours; generation/backoff can delay this.

### Persisted configuration contract

- Every successful source write stores immutable ID/hash, originating physical workspace, timestamp, and the effective validated configuration snapshot plus resolved global/workspace paths and hashes used by that writer. Defaults must be explicit in the snapshot. No credentials belong in metadata.
- The oldest pending source chooses the configuration workspace and governing snapshot for a pending epoch. Batch only that workspace's sources. Persist the epoch snapshot, config hash, anchor, and provenance under lock. All runtimes execute the persisted snapshot, **not their own global-root interpretation**.
- Only a correctly attributed call from the configuration workspace may refresh its epoch configuration. Validate its currently resolved effective settings, persist a new snapshot/revision, and recompute eligibility from the same anchor, not from now. Other runtimes may observe/execute the frozen snapshot but cannot reinterpret/re-arm it. Running claims retain captured settings; a snapshot revision change fences their commit and leaves sources pending.
- Require the selected workspace to remain accessible and validate source/store attribution; missing workspace/config access blocks visibly. Another workspace cannot simply claim that path or run under its own overrides. A manual run from a different workspace reports the selected owner and refuses; invoke from the owning workspace instead. No implicit manual ownership override.
- After a batch, the next oldest pending workspace/snapshot owns the next epoch without resetting the last-attempt anchor. Sources from differing snapshots are not silently relabeled; record the explicitly refreshed epoch settings used for each batch.

## 5. Scheduling, claims, and arbitration

Successful deliberate updates mark pending sources; rollover preserves every unreviewed source. Generated checkpoint/shared/conflict material and legacy archives never become new distillation inputs.

First eligibility is first-pending time + interval. Later eligibility is last-attempt time + interval, or a longer error backoff. Persist anchors, attempt/success times, next eligibility, epoch revision/settings, pending state, claim and error. Startup/idle checks plus a cancellable due-time timer cover live operation. Clean branches generate nothing; downtime causes at most one catch-up attempt, not missed-interval bursts. Failed/stale jobs are rate-limited too. Manual `distill` bypasses time only; successful manual execution postpones automation.

Idle means the claiming runtime's known contributing sessions for that branch are idle. A busy local contributor defers its claim; remote idleness does not override local busy state. No distributed heartbeat service or global-idle promise. Remote/new writes remain pending outside immutable batches.

Under the repository lock, manual and automatic jobs acquire the same persisted branch claim: random fencing token, PID + process-start identity, source ID/hash batch, owner workspace/config snapshot revision, checkpoint/shared revisions, start and five-minute deadline. An active claim returns “already running.” Generate outside the lock. Deadline recovery may replace the token under lock; preserve attempt/backoff state. Commit requires the current token and unchanged captured source hashes, epoch, checkpoint, and shared revisions—even for empty or checkpoint-only results. Late owners cannot commit. Provider cancellation may not prevent a charge; timeout recovery can duplicate cost, never commits.

## 6. Hard budgets and progress semantics

Use the installed tokenizer consistently; count serialized headers, metadata, instructions, and formatting overhead, not just entry text.

| Surface | Hard ceiling and behavior |
| --- | --- |
| Normal/targeted read | 8,000 tokens total; bounded allocations up to 2,000 shared, 1,000 checkpoint, 5,000 branch, reduced for framing |
| Generated checkpoint / complete shared baseline | 1,000 / 2,000 tokens respectively |
| Model input | 12,000 total, with evidence at most 8,000; reserve 4,000 output and verify model supports input + reserve |
| New deliberate entry | 1,000 tokens; reject before writing if larger |

Return whole entries and visible omission/capacity markers. Targeted ID reads retrieve retained source content within the same aggregate cap; oversized individual content returns an explicit error and is never marked seen. Tail selects newest entries subject to section and aggregate limits.

**Delta pagination must make real progress:** reserve at most half the branch allocation for pinned/unresolved replay while unseen entries exist. Select the oldest unseen eligible whole entry **before** spending replay allocation; if it needs more than the nominal unseen half but fits the total branch allowance, shrink/omit replay for that response. A replay cannot consume the space needed by the next unseen entry. Persist seen ID/hash pairs only for entries actually returned. If the oldest entry cannot fit even an otherwise empty applicable response, return an explicit blocked-ID/size diagnostic and targeted-read guidance, without marking it seen or silently skipping it. Test repeated delta calls until every fitting finite-backlog entry has appeared, including near-limit entries with pinned replay present.

Model batching chooses oldest whole sources within remaining input/evidence budgets after accounting for the complete shared baseline, checkpoint, instructions, and metadata. Iterate/index backlog rather than loading it unboundedly. Oversized inherited sources block visibly, never truncate or count as consumed. Only the selected committed batch becomes reviewed; later sources wait a normal interval. A valid empty promotion or durable conflict consumes only its cited batch. Invalid output, timeout, unavailable model, capacity failure, interruption, or failed commit leaves sources pending.

## 7. Distillation, conflicts, and manual correction

1. Under lock recover transactions, select an eligible whole-source batch, capture complete bounded shared baseline/checkpoint, and persist claim.
2. Generate outside lock using only the configured model, no tools. Treat source text as untrusted quoted data; accept no paths or executable operations.
3. Validate structured checkpoint/proposals, sizes, exact source ID/hash citations from the batch, target identity/prior hash, classification and baseline revision. Reject unknown citations/operations.
4. Allow `add`, `update`, `conflict`; no automatic delete. `update` may clarify or add supporting provenance only when meaning is unchanged and prior hash matches. Changed assertions/decisions, disagreement, or uncertain equivalence become conflicts. Adds must declare no contradiction against the **complete** baseline. Exact normalized duplicates merge provenance.
5. Branch progress, blockers, and unmerged implementation claims are not repository-wide facts. Semantic equivalence/contradiction classification is model judgment, not a deterministic correctness guarantee or independent code verification.
6. Persist stable conflict IDs, source IDs/hashes, target ID/hash, proposal, reason and resolution status in `conflicts.md`, independently of replaceable `checkpoint.md`. Durable conflict recording counts as reviewed once, appears in status, stays out of shared reads, and does not auto-retry. Later checkpoint rewrites must never erase it.
7. Reacquire lock, recover, verify fencing/revisions and commit checkpoint, shared proposals, conflicts, history and reviewed state in one recoverable transaction. Increment checkpoint revision for empty/conflict-only commits. Revision races leave pending sources for scheduled retry, not semantic conflicts.

### Smallest maintenance operation: explicit stopped-runtime file edits

Do not imply an unimplemented maintenance API. Document this exact manual correction workflow for shared-cap exhaustion and conflict resolution:

1. Stop **all** runtimes using the store; verify no live claim/owner. Back up the entire store. Do not edit a half-recovered transaction: first let the normal storage recovery path finish, then stop again.
2. Edit `shared.md` using its documented record schema: retain unchanged stable IDs, remove/correct only deliberately chosen assertions, retain required provenance and recompute content hashes using the project's documented hash algorithm. Preserve pre-edit bytes in `history/`. Keep the complete baseline within 2,000 tokens. Never edit raw sources or reviewed metadata to manufacture success.
3. For resolved conflicts, explicitly annotate the stable conflict record with the chosen outcome, operator/time, and resulting target ID/hash; preserve the original proposal/evidence. Do not delete conflict records.
4. On startup under lock, detect actual shared/checkpoint/conflict content-hash changes against stored revisions, validate full schemas and caps, archive prior known revisions, bump revisions, fence any old claim, and record an external-maintenance event before serving reads/scheduling. Invalid manual edits block visibly without overwriting them. Pending capacity-blocked sources remain pending and become eligible under normal interval/backoff after correction.

Provide a documented worked example and a validation-only check through `status`; no generation or hidden automatic replacement during validation. External edits while runtimes run are unsupported.

## 8. Durability and security

Use a standard-library repository-wide cross-process lock with ownership tokens, bounded wait and conservative stale-owner recovery using PID/process-start identity. Never break a live lock based only on age. Cover updates, imports, rollover, claims, reads, ledger writes and commits; never hold the lock through model calls.

Use same-directory temporary writes/rename and a minimal durable transaction intent with old/new hashes and staged payloads for multi-file changes. Specify deterministic recovery and write ordering, including appropriate file flushes supported by the platform. Commit reviewed state only with durable results. Every participating reader acquires the lock, recovers, validates revisions, then copies a bounded consistent snapshot; observable state is old or new, never mixed. Preserve raw source/history evidence; no pruning. Test Windows rename/error behavior, not only POSIX assumptions.

Create POSIX directories/files with 0700/0600; Windows inherits repository ACLs. Storage is not encrypted or a confidentiality guarantee. Never log credentials. Document disk-full, permissions, malformed state, and manual-edit failures visibly rather than silently resetting metadata.

## 9. Operator surface and compatibility

- Preserve `read`/`update`, legacy V1 wrapper and named exports in `src/continuity.js`.
- Add targeted memory-ID reads, `status`, and plugin-only immediate `distill`. Status reports store/branch, configuration owner and frozen snapshot/global root, model/interval/eligibility, pending/reviewed, claim/error, conflicts/capacity and legacy paths. Include actionable blocked-ID/ownership/maintenance diagnostics.
- Standalone storage/read/update works; generation explains that plugin installation is required. Plugin and standalone registration are mutually exclusive so updates cannot double-register.
- Dispose owned timers/generation work on unload while retaining pending disk state. Use explicit continuity reads rather than new prompt injection.

## 10. Implementation files and checkpoints

Execute in order; do not proceed past a failed gate. Keep dependencies minimal and reuse existing helpers.

| Checkpoint | Exact implementation/test/documentation files | Exit evidence |
| --- | --- | --- |
| A: baseline/preflight | Inspect installed sources from §2; add `tests/integration/README.md` with verified contracts, runtime/Bun/DB setup and unresolved gates | Existing `bun test tests/continuity.test.js --timeout 20000` result recorded; field/permission gates verified or explicitly blocked |
| B: core compatibility | Extract SDK-independent `src/core.js`; keep `src/continuity.js` wrapper/exports; update `tests/continuity.test.js` and touched fixtures | Legacy behavior passes; no SDK imports in shared core; only encountered Windows assertion fixes |
| C: storage/config/reads | Add `src/storage.js` (scope, locks, transactions, recovery, imports), `src/config.js` (JSONC, roots, snapshots); wire all core/wrapper callers; add `tests/storage.test.js`, `tests/config.test.js`; extend `tests/continuity.test.js` | Scope/migration/config/locking/recovery and real delta-progress tests pass; no lost raw sources |
| D: distillation engine | Add `src/distill.js` with injected clock/generator, scheduler, claims, budgets, validation, conflicts and maintenance detection; add `tests/distill.test.js` | Fake-clock, fencing, whole-batch, capacity/manual-correction and conflict-persistence tests pass without paid calls |
| E: dual adapters | Add `src/plugin.js`, `src/plugin-v1.js`, `src/plugin-v2.js`, `tests/plugin.test.js`; update `package.json` exports/scripts and `bun.lock` only as necessary | Both loaders work independently; permissions/attribution/disposal tests pass; no duplicate registration |
| F: live integration | Add `tests/integration/branch-continuity.ps1` plus harness instructions/evidence format in `tests/integration/README.md` | Required psmux acceptance below passes on both installed forks; mocks/API-only checks are insufficient |
| G: operator documentation | Update `README.md`, `docs/continuity-tool.md`, `docs/layered-continuity-memory-architecture.md`; mark conflicting unimplemented parts of `docs/plans/05-archive-assimilation-and-living-wiki.md` superseded | Installation, overrides/epoch ownership, errors, recovery/maintenance examples and limits match tested behavior; larger living-wiki scope remains deferred |

No source files are to be changed while merely reviewing this plan. During implementation, update callers, fixtures, exports and docs together rather than leaving partial compatibility.

## 11. Required end-to-end and failure tests

### Deterministic and subprocess suites

- Parsing/IDs/hashes/sections, rollover, token accounting including framing; tail/delta, targeted reads, pinned replay plus a near-allocation unseen entry, repeated pagination, no falsely seen/reviewed hashes.
- Global/workspace field inheritance, JSONC comments/trailing commas/errors, fallback, differing runtime global roots, frozen snapshots and owner-only refresh, same-anchor re-arm, inaccessible owner and refusal of foreign-workspace manual execution.
- Throwaway Git repository with two worktrees: distinct branches isolated, primary/subagent same-branch full sharing, repository-wide shared reads; slash/case collisions, detached/unborn, checkout switch, delete/name reuse, non-Git scope. Confirm no tracked Markdown changes/ignore-rule additions. Legacy import is automatic, byte-preserving, idempotent and crash-safe.
- Concurrent processes/injected crashes at every transaction boundary: update/rollover/import safety; old-or-new read snapshots; simultaneous manual/automatic/empty-result claims; death after claim; timeout token replacement and late fenced completion; stale locks and process identity reuse; shared/checkpoint/source/config revision races; disk/write failures.
- Fake clock: first delay and 2.5/5/7.5-hour approximate eligibility with promptly completed dirty/idle work, clean suppression, busy-local deferral, remote writes during generation, restart single catch-up, failure/backoff, manual postponement and next-workspace selection.
- Finite fitting backlogs drain without starvation; exact budget boundaries, inherited oversized source diagnostics, complete baseline in input, unknown citations, invalid/oversized output, unavailable model, capacity failure and stopped-runtime correction. Assert pending preservation and no paid fast retry loop.
- Contradictory current-revision updates never silently replace shared meaning. Conflict-only/empty jobs fence correctly and review only their batches; conflict records survive repeated checkpoint rewrites and restart. External-edit reconciliation bumps revisions; malformed edits block without data loss.
- Adapter denial tests attempt built-in/custom/MCP and subsequently registered tool calls: no execution or permission prompt. Cover temporary-session cleanup/failure, recursion exclusion, model mapping, subagent attribution, unload and no unsolicited user turns.

### Mandatory live psmux matrix: both installed runtimes

1. Create test-owned repo/worktrees, isolated config roots and dedicated temporary databases. Explicitly pin `OPENCODE_DB`, inspect effective paths, and use verified Bun/executable per fork. Abort on any production/shared DB path. Do not change production configuration.
2. Launch actual opf18 and opf2x TUI sessions in psmux. Record runtime versions, config-root paths, effective snapshot, DB paths, source-contract gate results and pane/log captures. Verify configured `zai-coding-plan/glm-5.3-flash` and credentials before small real generation calls; unavailable access blocks acceptance, never substitutes a model.
3. Drive actual primary and spawned-subagent prompts to write/read deliberate entries. Demonstrate full same-branch sharing, different-branch isolation, shared reads across branches, and correct linked-worktree attribution. Prove transcript-only content is not distilled.
4. Use a short **test-only** configured interval to demonstrate automatic checkpoint/shared promotion, clean suppression, local busy deferral, immediate manual execution, restart recovery and no repeated empty work. Shipped default remains 2.5 hours; deterministic tests prove that cadence.
5. Exercise both runtimes against the same test store: competing claims produce one durable commit, differing global roots do not change the pending epoch's model/settings, and foreign-workspace manual calls cannot hijack ownership. Show durable conflict visibility across checkpoint rewrites and at least one capacity-block/manual-correction/resume cycle.
6. Capture tool-denial evidence for the real V1 generation path and no-tool V2 path, including cleanup. Stop sessions; remove only test-owned resources, retaining a sanitized acceptance report and artifact references.

Acceptance requires all checkpoints and both live matrix rows, with commands/results and observed artifacts—not merely implementation completion. Report any unverified fork field, permission capability, model access or live environment as **blocked**.

## 12. Known limits and final audit

Semantic promotion may still be wrong; citations, raw sources and history enable correction. Shared-cap exhaustion and inaccessible owners intentionally block work until corrected. Automation runs only while OpenCode is alive; per-dirty-branch frequency affects cost. Timeout recovery may duplicate provider charges. No encryption, pruning, transcript harvesting, distributed global idleness or branch lifecycle automation.

Before declaring completion: verify legacy compatibility, store attribution, delta progress, durable conflict retention, config epoch consistency, fencing/recovery, stopped-runtime maintenance and both live acceptance reports. List any remaining blocker explicitly; never label a partially verified adapter supported.

## Implementation evidence (in progress)

- Core extraction, branch storage/configuration, transactional runtime, scheduler, and distillation are implemented; the combined deterministic suite is 119 passing tests across 8 files after review remediation (state validation, recoverable lock guards, claim/epoch fixtures, content-based duplicate suppression).
- Separate `src/runtime.js`, `src/schema.js`, and `src/scheduler.js` hold transaction orchestration, JSON Schema, and timer wiring rather than mixing them into SDK adapters.
- Installed V2 source corrected the model reference to `{providerID,id}`. Sessionless generation does not expose a hard output bound; a bounded native alternative must pass source/adapter preflight before V2 paid generation. No fork-source changes are authorized.
- Source preflight and adapter tests subsequently established the isolated `session.generate` alternative above, with explicit model, no inherited context/tools, scoped output limit, abort and cleanup. This is the documented implementation adjustment; no transcript capture or provider credential extraction was added.
- Live V2 (`tests/integration/live-v2.md`): plugin load from a directory entry (harness file-entry defect fixed), primary-session status/update, idle-triggered automatic distillation with real generation, cross-runtime shared promotion with merged citations (V1-written + V2-written sources), cross-branch isolation read. Remaining live rows: tool-denial attempts, arbitration/refusal, restart, competing claims.
- Live V1 (`tests/integration/live-v1.md`): registration, update/read/status, subagent + linked-worktree sharing, isolation, transcript exclusion verified; the paid generation call is blocked by environment (TUI keystroke transport in relaunched panes; an unrelated user-global goal-plugin crashes V1 headless `run` mode). Not supported until a live paid generation passes.
- Live verification uses test-owned psmux names and absolute temporary DB/config paths only. It remains incomplete; passing unit tests does not satisfy checkpoint F.
- Post-review remediation (all findings closed, suite 122/122 at that point): lock acquisition now stages the owner record in a candidate directory and atomically renames it (a crash can no longer wedge the store; cleanup errors never mask results); delta reads scan past blocked entries with per-ID blocked markers so fitting entries are never starved; transactions stage all payloads in one durably-written `payloads.json` (O(1) fsyncs per commit) and committed scratch directories are pruned; orphan transactions (payloads without intent) block visibly instead of silently skipping; the scheduler forgets deleted/dead sessions (V2 `session.deleted`, V1 lookup-failure) so a dead session cannot hold a branch busy; PowerShell identity probes fall back `pwsh`→`powershell` via `Bun.spawnSync` (promisified `execFile("pwsh")` can hang under this Bun on Windows — found live) and a process's own identity is cached; distillation timeout is sized from the claim deadline and deadlines are checked at current clock; V2 event handling survives transient lookup errors instead of deactivating the plugin; generation-session cleanup failures never discard a paid result; adapter tests now pin the real host hook order and that model-returned tool-call parts cannot execute.
- Live matrix completion (2026-11-08, second harness root; suite now 125/125): V1 paid generation proven (3 completed distills through the wildcard-denied session); foreign-workspace manual refusal proven (`Epoch owned by …; invoke distill there`); competing claims proven (second manual distill returned `already-running` inside an active claim window; commits serialized); restart recovery, claim-expiry fencing, dead-owner expired claim with pending preserved, and V2 transcript canary all observed live. Three more live-driven engine fixes landed with regression tests: citation-hash canonicalization, exact-or-unique-prefix target resolution with authoritative prior hash, and markdown-fence stripping. Remaining open live row: a hostile tool-execution attempt against a denied generation session (mock-verified only). Evidence: `tests/integration/live-v2.md`.
- Known environment hazard: per-file metadata/fsync latency on this volume degraded ~10× during the session (small-file reads ~11 ms). Tests remain green with generous timeouts; runtime performance on a healthy volume is unaffected by design (O(changes) metadata ops, O(1) fsyncs).
