# opencode-continuity-tool

A plugin for [OpenCode](https://opencode.ai/) that provides structured, validated management of `docs/CONTINUITY.md` -- a living document designed to survive context compaction across AI coding sessions. The tool enforces canonical formatting, shared UTC timestamps, provenance tracking, and automatic token-budget compaction with archival to `docs/MEMORY.md`.

## Why

AI coding assistants lose context between sessions. `CONTINUITY.md` solves this by acting as a persistent briefing document that captures plans, decisions, progress, discoveries, and outcomes in a structured, machine-readable format. This tool ensures every entry is validated, timestamped, and formatted consistently -- and that the document never grows beyond a configurable token budget.

## Features

- **Two commands** -- `read` (non-mutating tail view) and `update` (append entries with optional compaction)
- **Shared UTC timestamp** -- all entries in a single `update` call share one timestamp
- **Provenance tracking** -- every entry is tagged with its source (`USER`, `CODE`, `TOOL`, `ASSUMPTION`, `UNCONFIRMED`)
- **Plan linking** -- optional `[plan:slug]` tags connect entries to specific build plans
- **Schema validation** -- section names, provenance values, plan slugs, and text length are validated via Zod schemas
- **Auto-creation** -- `docs/CONTINUITY.md` is created from a canonical template if missing
- **Token-budget compaction** -- when the document exceeds a configurable upper token threshold, oldest entries are trimmed per-section (respecting ratio weights) down to a lower target
- **Archival** -- compacted entries are preserved in `docs/MEMORY.md` under their original section headers
- **Silent successful updates** -- update returns an empty output string on success; errors are surfaced normally

## Requirements

- [Bun](https://bun.sh/) runtime (for running and testing)
- [OpenCode](https://opencode.ai/) (to use as a plugin tool)
- [tiktoken](https://github.com/openai/tiktoken) (installed as a dependency; used for token counting)

## Installation

1. Clone this repository into your project or as a standalone tool:

   ```bash
   git clone <repo-url> opencode-continuity-tool
   cd opencode-continuity-tool
   bun install
   ```

2. Register the tool in your OpenCode configuration. Point your `tools` configuration at `src/continuity.js`:

   ```jsonc
   // .opencode/config.json (or equivalent)
   {
     "tools": {
       "continuity": {
         "path": "path/to/opencode-continuity-tool/src/continuity.js"
       }
     }
   }
   ```

   See the [OpenCode custom tools documentation](https://opencode.ai/docs/custom-tools/) for full configuration details.

## Document Structure

The tool manages `docs/CONTINUITY.md` with five canonical sections:

```markdown
# CONTINUITY

## [PLANS]
- [id:plans-202603011822-user-2d3f9d713e4c] 2026-03-01T18:22Z [USER] [plan:01-continuity-tool] Next steps and checklists.

## [DECISIONS]
- [id:decisions-202603011822-code-e81db3c11d10] 2026-03-01T18:22Z [CODE] Architectural choices and rationale.

## [PROGRESS]
- [id:progress-202603011822-tool-8edacabeec94] 2026-03-01T18:22Z [TOOL] Course changes and why.

## [DISCOVERIES]
- [id:discoveries-202603011822-tool-15767297c53d] 2026-03-01T18:22Z [TOOL] Notable behaviors, tradeoffs, bugs.

## [OUTCOMES]
- [id:outcomes-202603011822-code-330d1194f0f8] 2026-03-01T18:22Z [CODE] Completion summaries.
```

### Entry Format

```
- [id:<memory-id>] YYYY-MM-DDTHH:MMZ [PROVENANCE] [plan:slug] <text>
```

Legacy bullets without `[id:...]` remain readable. The tool derives a deterministic memory ID from the section, timestamp, provenance, optional plan slug, and normalized text when parsing older entries.

| Field | Description | Required |
|---|---|---|
| Memory ID | Stable identity for the memory entry. New writes include it explicitly; legacy entries derive it on read. | Yes for new writes |
| Timestamp | ISO 8601 UTC, minute precision. Auto-generated. | Yes |
| Provenance | One of `USER`, `CODE`, `TOOL`, `ASSUMPTION`, `UNCONFIRMED` | Yes |
| Plan slug | Lowercase alphanumeric with dots/hyphens (e.g., `01-continuity-tool`) | No |
| Text | Single-line, non-blank, 1-400 characters | Yes |

### Memory identity and content hashes

- New continuity writes include a stable `[id:<memory-id>]` prefix.
- Legacy entries are still supported and receive deterministic derived IDs during parsing.
- The tool normalizes memory text before hashing by collapsing whitespace and line-ending differences; whitespace-only changes are treated as equivalent.
- Content hashes use the format `sha256:<hex>` so future retrieval phases can suppress unchanged entries within a session.

## Usage

### Read Command

Read supports two modes without modifying project docs. Include `sessionId` when using `read` unless you explicitly set `mode: "tail"`:

- `mode: "delta"` (default) returns only new or changed memories for a session and stores its seen-ledger outside the repository docs in OS temp storage.
- `mode: "tail"` returns the latest N bullet lines per section.

```js
continuity({
  command: "read",
  read: {
    sessionId: "session-123", // required for default delta mode
    includePinned: true,
    includeUnresolved: true,
  },
})
```

```js
continuity({
  command: "read",
  read: {
    mode: "tail",
    linesPerSection: 5, // optional, default: 5
  },
})
```

**Output:** A text report with section headers in canonical order and the eligible bullet entries under each. Read output omits internal `[id:...]` prefixes. When delta mode finds nothing new, it returns:

```
No new or changed task memories.
```

```
## [PLANS]
- 2026-03-03T22:03Z [CODE] [plan:03-continuity-command-read] Implemented read mode.

## [DECISIONS]
- 2026-03-03T22:03Z [CODE] [plan:03-continuity-command-read] Switched to command-based interface.

## [PROGRESS]
...

## [DISCOVERIES]
...

## [OUTCOMES]
...
```

### Update Command

Appends validated entries to the specified sections and optionally triggers compaction.

```js
continuity({
  command: "update",
  updates: [
    {
      section: "PLANS",
      provenance: "USER",
      plan: "01-continuity-tool",
      text: "Implement continuity update tool with shared UTC timestamp.",
    },
    {
      section: "DECISIONS",
      provenance: "CODE",
      text: "Use a local .opencode tool with schema validation.",
    },
  ],
  compaction: {                      // optional
    upperTokenThreshold: 10000,      // optional, default: 10000
  },
})
```

**Output:** An empty output string on success. Updated entries are written to `docs/CONTINUITY.md`; validation/runtime failures are returned as errors.

## API Reference

### Arguments

| Parameter | Type | Command | Description |
|---|---|---|---|
| `command` | `"read"` \| `"update"` | Both | **Required.** Operation mode. |
| `updates` | `Update[]` | `update` | **Required for update.** Array of entries to append. |
| `compaction` | `Compaction` | `update` | Optional. Token-budget compaction settings. |
| `read` | `ReadConfig` | `read` | Optional. Read output configuration. |

### Update Object

| Field | Type | Description |
|---|---|---|
| `section` | `enum` | One of `PLANS`, `DECISIONS`, `PROGRESS`, `DISCOVERIES`, `OUTCOMES` |
| `provenance` | `enum` | One of `USER`, `CODE`, `TOOL`, `ASSUMPTION`, `UNCONFIRMED` |
| `plan` | `string?` | Optional slug matching `^[a-z0-9][a-z0-9.-]*$` |
| `text` | `string` | Single-line, non-blank, 1-400 characters |

The written bullet line also includes an internal memory ID and supports deterministic derived IDs for legacy lines when parsing existing continuity content.

### Compaction Object

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable/disable automatic compaction. |
| `upperTokenThreshold` | `integer` | `10000` | Token count that triggers compaction. |
| `lowerTokenThreshold` | `integer` | `upperTokenThreshold / 2` | Target token count after compaction. The effective value is always derived from `upperTokenThreshold`. |
| `totalTokenThreshold` | `integer` | -- | Legacy alias for `upperTokenThreshold`. |
| `encoding` | `string` | `"cl100k_base"` | tiktoken encoding name. |

Threshold precedence is: explicit `upperTokenThreshold`, else legacy `totalTokenThreshold`, else inferred `lowerTokenThreshold * 2`, else default `10000`.

### ReadConfig Object

| Field | Type | Default | Description |
|---|---|---|---|
| `linesPerSection` | `integer` | `5` | Number of most recent bullet lines to return per section. |
| `mode` | `"tail" \| "delta"` | `"delta"` | Read compatibility mode. Include `sessionId` unless you explicitly set `tail`; `delta` returns only new/changed session memories, while `tail` returns section tails. |
| `sessionId` | `string` | -- | Include this when using `read` unless you explicitly set `mode: "tail"`. It is required for default `mode: "delta"` and persists the session-local seen ledger outside the repo docs. |
| `includePinned` | `boolean` | `false` | In delta mode, include pinned entries even when unchanged. |
| `includeUnresolved` | `boolean` | `false` | In delta mode, include entries with `[status:unresolved]` even when unchanged. |

For delta mode, the seen-ledger is stored under the OS temp directory using a worktree hash plus `sessionId`, so read requests do not mutate repository documentation files.

## Compaction

When the total token count of `docs/CONTINUITY.md` exceeds the upper threshold after an update, the tool automatically:

1. **Computes per-section token budgets** using ratio weights (derived from real-world continuity data) to allocate the lower threshold across sections proportionally.
2. **Removes oldest bullet entries** within each section until each section meets its budget.
3. **Continues trimming** from the most over-budget section if the document still exceeds the lower threshold, preserving section ratios as it converges.
4. **Archives removed entries** into `docs/MEMORY.md` under their original section headers.
5. **Logs a compaction event** in the `DISCOVERIES` section.

### Section Ratio Weights

| Section | Weight | Approximate % |
|---|---|---|
| PLANS | 4,339 | 9.1% |
| DECISIONS | 5,175 | 10.8% |
| PROGRESS | 22,471 | 47.1% |
| DISCOVERIES | 6,622 | 13.9% |
| OUTCOMES | 9,126 | 19.1% |

These weights reflect typical real-world usage patterns where PROGRESS entries dominate.

### MEMORY.md

`docs/MEMORY.md` is an archival file that stores entries removed during compaction. It is not a source of truth -- it preserves history for reference. The file includes reserved `[THEMES]` and `[MILESTONES]` sections for future compaction phases.

```markdown
# MEMORY

## [PLANS]
## [DECISIONS]
## [PROGRESS]
## [DISCOVERIES]
## [OUTCOMES]
## [THEMES]
## [MILESTONES]
```

## Validation & Error Handling

The tool rejects invalid input and leaves the file unchanged when validation fails:

| Condition | Error |
|---|---|
| Multi-line text (contains `\n` or `\r`) | `text must be a single line` |
| Blank text | `text must not be blank` |
| Missing section header in existing file | `Missing section header(s): <names>` |
| Duplicate section header | `Duplicate section header: <name>` |
| `updates` provided with `read` command | `updates are not supported for read command` |
| Empty `updates` with `update` command | `updates must be provided for update command` |
| Text begins with bracketed metadata-like token | `text must not start with a bracketed token` |
| Missing `context.worktree` | `Missing worktree in tool context` |

Compatibility behaviors:
`compaction` on `read` is ignored, `read` on `update` is ignored, and `lowerTokenThreshold` is normalized from `upperTokenThreshold` when needed.

## Testing

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with temporary worktrees to avoid mutating repository files.

```bash
# Run all tests (use extended timeout for compaction tests)
bun test tests/continuity.test.js --timeout 20000
```

### Test Coverage

| Test Case | What It Verifies |
|---|---|
| Append entries after last bullet | Entries appear after existing bullets with shared timestamp |
| Preserve input order | Multiple entries in one section maintain insertion order |
| Create file when missing | Template with all 5 sections is auto-created |
| Missing section header | Rejects update and leaves file unchanged |
| Multi-line text rejection | Rejects and leaves file unchanged |
| Bracket-token text rejection | Prevents metadata injection through leading text tokens |
| Legacy and ID-prefixed parser coverage | Supports both formats, status/pin parsing, and malformed-line rejection |
| Builder/parser round trip | New writes parse back into matching memory metadata |
| Hash normalization stability | Whitespace-only differences hash equivalently |
| Sparse deterministic IDs | Derived IDs remain deterministic with sparse inputs |
| Dot-plan slug support | Plan slugs with dots remain valid in IDs and entry output |
| Read latest entries per section | Returns tail of each section without mutation |
| Mixed legacy and ID reads | Tail mode supports both old and new entry formats |
| First delta read | Returns new memories and seeds a session ledger |
| Repeated delta read | Returns `No new or changed task memories.` when nothing changed |
| Delta change detection | Changed content for the same memory ID reappears |
| Delta on legacy-only files | Derived IDs work end-to-end without explicit `[id:...]` prefixes |
| Delta pinned replay | Pinned entries can be re-included on request |
| Delta unresolved replay | `[status:unresolved]` entries can be re-included on request |
| Delta validation | Invalid read modes and bad/missing session IDs are rejected |
| Ledger isolation and recovery | Delta ledger stays outside worktree and recovers from corrupt data |
| Skip compaction under threshold | No MEMORY.md created when under budget |
| Truncation and archival | Oldest entries removed, archived to MEMORY.md, tokens within budget |
| Mixed-format compaction | Compaction continues to handle legacy and ID-prefixed entries |
| Legacy threshold compatibility | `totalTokenThreshold` maps correctly to upper/lower |

## Project Structure

```
opencode-continuity-tool/
  src/
    continuity.js          # Plugin implementation (exported as OpenCode tool)
  tests/
    continuity.test.js     # Bun test suite
  docs/
    CONTINUITY.md          # Live continuity document (managed by the tool)
    CONTINUITY_DUMMY.md    # Large fixture for compaction tests
    continuity-tool.md     # Tool specification / design doc
    plans/
      01-continuity-tool.md          # Initial build plan
      02-continuity-compaction.md    # Compaction feature plan
      03-continuity-command-read.md  # Read command plan
      04-layered-continuity-memory.md # Layered memory build plan
  package.json
  bun.lock
```

## Roadmap

The compaction roadmap below is scoped to the original archival flow. The broader layered-memory rollout is tracked separately in `docs/plans/04-layered-continuity-memory.md`.

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | Done | Raw truncation with oldest-first removal and MEMORY.md archival |
| **Phase 2** | Planned | Generate `[THEMES]` and `[MILESTONES]` from compacted entries |
| **Phase 3** | Planned | Replace raw archived lines in MEMORY.md with grouped summaries |

## License

This project is private. See `package.json` for details.
