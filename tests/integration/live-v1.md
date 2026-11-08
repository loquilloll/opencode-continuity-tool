# V1 live acceptance — partial, blocked

Date: 2026-11-07, observations approximately 20:31–20:38 UTC.
This is actual psmux/TUI evidence, **not full live-matrix acceptance**. V2 was not launched.

## Environment and retained artifacts

- Run root: `C:/Users/alvins/AppData/Local/Temp/opencode/continuity-ed5f246446ab4b5ea9985b2df9903acc` (called `$r` below).
- V1 source: `C:/Users/alvins/Documents/git/opencode-v1.18.5/packages/opencode/src/index.ts`.
- Package version `1.18.5`; source HEAD `86dd82db019bc4d2ef393834b8f3741c1148c8cd`; Bun `1.3.14`.
- Actual invocation: `bun run --cwd <V1 packages/opencode> --conditions=browser ./src/index.ts <test checkout>`.
- Explicit DB: `$r/opf18/database/continuity.db`; config: `$r/opf18/config/opencode`.
- XDG data/state/cache/config all under `$r/opf18`; repaired `OPENCODE_TEST_HOME=$r/opf18/home`.
- Model shown in all three TUIs and primary request logs: `zai-coding-plan/glm-5.3-flash`.
- Test distillation interval `0.01` hours (36 seconds). Config contains an environment reference to `Z_AI_API_KEY`, not its value. Primary model requests succeeded; no auth export/import, production DB use, credential copy, or login automation was performed.
- Captures: `$r/opf18-{a,a-peer,b}-capture.txt` (redacted by harness); runtime log: `$r/opf18/data/opencode/log/opencode.log`. Review artifacts before sharing.
- Additional evidence obtained through **read-only** `bun:sqlite` queries on the test DB's `part` and `session` tables; no credential tables queried.
- Store: `$r/repo-a/.git/opencode-continuity`; artifacts/databases retained after cleanup.

## Startup diagnosis and harness repair

The original blank pane was cold source startup, not sufficient evidence of a plugin crash. One initial background dependency warning was observed:

```text
20:32:47.735Z background dependency install failed
dir=<test opf18 config directory>
ReleaseError: token mismatch
```

Initial logs also showed attempts to load `C:/Users/alvins/.opencode/opencode.json{,c}`. XDG/`OPENCODE_CONFIG_DIR` alone do not isolate home-directory discovery: installed V1 `src/config/paths.ts:34-38` explicitly searches `Global.Path.home`, and `src/config/config.ts:436-456` performs ignore/dependency setup on discovered config directories. No production DB/config write was intentionally requested; the initial launch lacked a before/after audit sufficient to prove zero incidental home-directory effects. Do not describe that initial launch as fully isolated.

Stopped only the three owned V1 sessions, patched the harness to pin `OPENCODE_TEST_HOME` for new and already-prepared runners, and relaunched V1 only. Installed `packages/core/src/global.ts:19` verifies that override. The repaired launch reached all three TUIs around 20:34:54–20:34:59 UTC. Harness parser and `git diff --check` passed after repair.

## Observed tool results

All prompts were sent through `psmux send-keys -l` followed by `Enter`, not through an API-only replacement.

| Check | Observed result |
| --- | --- |
| Primary deliberate update | `continuity update`, DECISIONS/USER, `Repository policy: the test fixture codename is amber-lantern.` completed with empty success output. Raw entry ID `decisions-202611072035-user-b570e4822fa4`. |
| Primary current-branch read/status | Tail read with branch omitted returned that exact entry. Status attributed physical `repo-a` to `refs/heads/branch-a`, pending 1. |
| Linked checkout sharing | Independent primary in `repo-a-peer` read the exact same ID/text; status reported physical peer workspace, `refs/heads/branch-a`, same store ID. |
| Different-branch isolation | Independent primary in `repo-b` read `No new or changed task memories.` Status reported `refs/heads/branch-b`, pending 0, no shared/checkpoint/source entries. |
| Actual spawned subagent | Parent used built-in `task` with `subagent_type=general`. Child read the decision and successfully wrote PROGRESS/CODE `Subagent verified same-branch continuity visibility.` |
| Transcript-only exclusion | Canary `violet-penguin-934` was present in the primary prompt but never deliberately submitted. After stopping sessions, recursive content search of the entire test continuity store found **0 matches**. This proves non-harvesting for this run, not successful distillation. |
| Tracked-file safety | `git status --porcelain` returned no entries in `repo-a`, `repo-a-peer`, and `repo-b` after the run. |

Read-only test DB session attribution:

```text
repo-a primary:      ses_e4846dc11ffefSJdr2eFG2IUvY
repo-a-peer primary: ses_e48465550ffeWIVjYxEV3yTXAe
repo-b primary:      ses_e484653f7ffeLPu6kpxZ4oDW76
general child:      ses_e48457dd5ffehhsESPSp4fw7iI
child.parent_id:    ses_e4846dc11ffefSJdr2eFG2IUvY
child.directory:    <test run>/repo-a
```

The model initially guessed `branch="repo-a"` on its first read and got no entries, creating an empty namespace `refs/heads/repo-a`. That was a model argument error, not branch attribution failure. A follow-up explicitly omitted `branch`; primary, peer and child then read the correct entry. Do not use the initial assistant explanation as evidence that pending entries cannot be read.

## Blocking distillation errors

Manual `continuity {"command":"distill"}` was attempted once through the real primary TUI. The persisted tool part has `status="error"` and exact error:

```text
undefined is not an object (evaluating 'text.split')
```

Separately, durable state records generation/API failure (including later idle scheduling):

```json
{
  "branch": "refs/heads/branch-a",
  "pendingCount": 2,
  "reviewedCount": 0,
  "lastAttemptAt": "2026-11-07T20:37:43.121Z",
  "nextEligibleAt": "2026-11-07T20:38:43.121Z",
  "claim": null,
  "error": {
    "message": "Continuity V1 API request failed",
    "at": "2026-11-07T20:37:43.121Z"
  }
}
```

Checkpoint/shared revisions stayed 1, with no generated contents or successful review. Branch B stayed clean with no attempt. The API failure currently discards endpoint/response detail (`src/plugin-v1.js:6-8`), so this report cannot honestly supply a provider/HTTP stack. Inspection suggests a second tool-result formatting problem: `src/runtime.js:219` returns the distillation result object directly through the V1 tool bridge rather than a text result. This is a diagnosis to verify, not a captured stack trace.

No owned distiller session remained in the test DB query: only the three primary sessions and the general child were present. This does **not** prove denial before a paid generation request; creation may never have been reached, or cleanup may have removed it. Actual wildcard-denial persistence/tool-execution attempts, successful shared promotion/read across branches, generated checkpoint, and automatic successful distillation remain **blocked/unverified**. Do not claim those passed. Pending source preservation and error backoff were observed.

## Cleanup and rerun

Executed harness Capture then Cleanup with `-Runtime opf18`; a subsequent psmux pane listing had no names matching this run GUID. Only exact owned V1 sessions were stopped. No V2 session was started. Test files/DB remain for diagnosis.

```powershell
$h = '.\tests\integration\branch-continuity.ps1'
$r = "$env:LOCALAPPDATA\Temp\opencode\continuity-ed5f246446ab4b5ea9985b2df9903acc"
& $h -Action Launch -Runtime opf18 -RunRoot $r -PreflightVerified # only after fixes/gates
& $h -Action Capture -Runtime opf18 -RunRoot $r
& $h -Action Cleanup -Runtime opf18 -RunRoot $r
```

Next: fix/diagnose the V1 API and text-result errors, restart to load fixed adapters, then repeat manual/automatic promotion and denial tests. This report does not cover conflict/capacity maintenance, competing claims, restart recovery, or the complete two-runtime matrix.
