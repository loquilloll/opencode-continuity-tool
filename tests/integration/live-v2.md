# V2 live acceptance — core matrix passed

Date: 2026-11-07/08, runs across two harness roots. Actual psmux/TUI evidence.
Latest root: `$env:LOCALAPPDATA\Temp\opencode\continuity-450dea9617ea448bb447b3a9656d75ff` (`$r2`); earlier root `continuity-ed5f246446ab4b5ea9985b2df9903acc` (`$r1`).

## Matrix status after 2026-11-08 session

| Row | Result |
| --- | --- |
| Plugin load (directory entry), status/update/read | ✅ live (both roots, after fixing the harness's PowerShell single-element-array collapse that serialized `plugin`/`plugins` as a scalar string — V1 rejected the config, V2 silently loaded no plugin) |
| Automatic distillation, real generation | ✅ live multiple times; final clean cycle: pending drained via valid (empty) promotion, checkpoint rebuilt from batch only |
| Shared promotion + citations | ✅ live: V1-written and V2-written sources merged into one shared record; cedar-falcon fact promoted by the V1 adapter citing its own source |
| Cross-branch isolation | ✅ live (branch-b sees only shared) |
| Transcript non-harvesting (V2) | ✅ live: `grape-badger` canary in prompt, 0 matches in entire store |
| Restart recovery | ✅ live: pending survived full Cleanup/relaunch; fresh processes claimed and distilled it with no prompt |
| Claim fencing under expiry | ✅ live: a generation finished ~36 s after its claim deadline; commit refused, pending preserved, no duplicate shared writes |
| Failure preservation + backoff | ✅ live repeatedly (validation rejections left pending intact and scheduled retries) |
| **V1 paid generation** | ✅ **live**: `{"status":"completed","reviewed":1,"conflicts":0}` through the wildcard-denied temp session, twice more via the peer (3 total V1 generations) |
| Foreign-workspace refusal | ✅ live: repo-a manual distill returned `blocked: "Epoch owned by …repo-a-peer; invoke distill there"`, no hijack |
| Competing claims (two same-workspace manuals) | ✅ live: fired inside an active claim window (claim-watched), V2-a returned `{"status":"already-running"}`; V1-a also refused while a third claimant held the store; commits serialized one-at-a-time across the session (4 durable batches, no duplicates) |
| Dead-owner expired claim | ✅ live (unplanned): claimant process died mid-generation; deadline expired, pending preserved, no partial writes — recovery path identical to the proven restart row |
| **Shipped-default 8h cadence + overnight recovery** | ✅ live (2026-11-08): 3 pending sources survived ~12 h downtime, a dead-owner expired claim, and an error-backoff reschedule; fresh processes recovered the stale claim at boot and a manual distill drained all 3 in one batch through the denied session, merging their citations into the existing shared record (4 total) instead of duplicating |
| Malicious tool-execution attempt against the denied session | ❏ open (mock-verified only; generation sessions persist deny rules and strip tools via hook — no live hostile attempt yet) |

## Live-driven engine fixes (each found by a real paid run)

1. Distill results returned through the V1 tool bridge as objects → V1 `text.split` crash. Fixed (JSON string).
2. glm-5.3-flash copies the *existing* checkpoint and cites its historical source instead of the batch → strict citation rejection loop. Fixed in the prompt (citations must come only from the current `sources` array; rebuild the checkpoint from the batch).
3. Hash transcription errors in otherwise-correct citations → canonicalization to the batch's authoritative pairs (unknown IDs still rejected). Added the regression test.
4. Validation errors now embed a truncated, whitespace-collapsed excerpt of the model output — this is what made (2) and (7) diagnosable from `state.json` alone.
5. `update` proposals transcribing the target id/hash imprecisely → targets resolve by exact-or-unique-prefix with the resolved record's authoritative prior hash; ambiguity/unknown still rejected. Regression test added.
6. Model output wrapped in markdown fences despite JSON-only instructions → fences stripped before parsing. Regression test added.
7. **Reasoning models consume the completion budget before emitting text** (observed: 3997/4000 tokens reasoning → empty text): the engine now requests 8000 completion tokens for headroom while adapters clamp to the model's reported output limit (floor 4000) and the returned JSON is still validated against the 4000-token budget. Regression test updated.
8. **`distillation.reasoning` effort convention added** (2026-11-08): optional `none|minimal|low|medium|high|xhigh|max` flows config → frozen snapshot → engine → adapters (`reasoningEffort` semantic option; V1 via `chat.params.options`, V2 via the generate hook). Live-calibrated twice: `zai-coding-plan/glm-5.3-flash` + `low` (reasoning spend collapsed 3997→42 tokens, distill completed in 17 s) and **`openai/gpt-5.6-luna` + `low`** (2026-11-08, opf18 with `-UseAuthJson`: authenticated via the user's auth.json copied into the isolated data root — V1 reads it natively; the wildcard-denied distiller session ran gpt-5.6-luna, promoted the marker fact with an exact first-try citation — no canonicalization/fence tolerance needed — in ~8 s). Harness now parameterized (`-ProviderId/-CredentialEnv/-Model/-Reasoning/-UseAuthJson`), generated config is JSON-validated at prepare time, and Cleanup deletes any copied auth.json.

## Environment notes

- PowerShell `ConvertTo-Json` collapses single-element arrays; the harness now assembles the plugin-list JSON manually. Both prepared roots predating that fix were patched in place.
- The first root's opf2x exe hash changed mid-session (rebuild); the harness guard refused launch until a fresh root was prepared — guard works.
- One V2 peer session went off-script (wrote `tmp/adhoc-distill.mjs` into the plugin repo and ran a distill with an env override). Rejected as evidence, pollution removed, session replaced. Owner-side updates for the refusal row were redone from the V1 peer.

V2 rows still live-pending after this session: competing claims (in flight), hostile tool attempt.

Environment: opf2x exe `release-v2.2.5` (`0.0.0-release-v2.2.5-202611012135`), test DB
`$r/opf2x/database/continuity.db`, config `$r/opf2x/config/opencode`, model
`zai-coding-plan/glm-5.3-flash` via `{env:Z_AI_API_KEY}`. No production DB/config touched.

## Harness defect found and fixed

The original harness configured V2 with a `file:///…/src/plugin.js` URL. V2 loads plugin
**directories** (package.json exports), never single files — the plugin silently never
loaded and the session model correctly could not find the tool. Fixed in
`tests/integration/branch-continuity.ps1` (V1 keeps the single-file entry; V2 now gets the
repository directory) and in the prepared run's `opf2x/config/opencode/opencode.json`.

## Observed results

| Check | Result |
| --- | --- |
| Plugin load + tool registration | `continuity` callable from the **primary** session; `status` returned full JSON (branch-a scope, empty docs, revisions 1) |
| Deliberate update | `command=update` DECISIONS/USER → status `pendingCount: 1` |
| Automatic distillation | With the 36 s test interval, the idle scheduler distilled **before** the manual call: a later `command=distill` returned `{"status":"clean"}` |
| Shared promotion | `$r/repo-a/.git/opencode-continuity/shared.md` holds one record “Repository policy: the test fixture codename is amber-lantern.” with **merged citations** from the V1-written source (`decisions-…-b570e4822fa4`, yesterday's opf18 run) and the V2-written source (`decisions-…-29b649cff248`) |
| Cross-runtime store | branch-a state: pending 0, reviewed 3 (two V1 sources + one V2 source), lastSuccess set, error none; two generation batches in `history/batches/` |
| Cross-branch isolation | branch-b (repo-b) tail read returns **only** the shared record; no branch-a journal entries; branch-b state untouched (reviewed 0) |
| Real generation path | V2 no-tools temporary session (`session.generate` + scoped hook) produced the validated JSON accepted by the engine |

V2 rows not yet exercised live: malicious tool-denial attempts against the generation
session, manual-override/refusal arbitration, restart recovery on V2, competing V1+V2
claims. Deterministic suites cover these against verified contracts; live confirmation
remains open.

## V1 generation call — blocked, narrow

Yesterday's V1 live run (`live-v1.md`) verified registration, update/read/status,
subagent sharing, isolation and transcript exclusion, but the paid generation call failed
inside the tool (`text.split` formatting, since fixed in `src/runtime.js`; plus an SDK API
error with diagnostics since improved in `src/plugin-v1.js`). Today's retry attempts were
blocked by environment, not by the plugin:

1. Relaunched opf18 TUI panes stopped accepting psmux keystrokes (empty captures, no new
   sessions in the test DB). One bun TUI process died during key delivery.
2. Headless `bun … run` in the pinned environment crashes in the user's globally declared
   `@prevalentware/opencode-goal-plugin` (effect Schema ParseError, its own state decode),
   which V1.18.5 loads from `~/.config/opencode/opencode.jsonc` regardless of the pinned
   `OPENCODE_CONFIG_DIR`; V1.18.5 has no negative `plugin` entries to disable it.

The V1 generation path (wildcard-denied temp session, explicit model, bounded output,
abort/delete cleanup) remains verified by the 20 adapter tests against inspected fork
source. A live paid V1 generation is still required before calling the V1 adapter
supported; rerun after removing/bypassing the goal plugin or from a TUI that accepts
input.
