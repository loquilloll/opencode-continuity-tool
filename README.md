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
- **Patch-style output** -- every update returns a diff-like preview showing what changed

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
- 2026-03-01T18:22Z [USER] [plan:01-continuity-tool] Next steps and checklists.

## [DECISIONS]
- 2026-03-01T18:22Z [CODE] Architectural choices and rationale.

## [PROGRESS]
- 2026-03-01T18:22Z [TOOL] Course changes and why.

## [DISCOVERIES]
- 2026-03-01T18:22Z [TOOL] Notable behaviors, tradeoffs, bugs.

## [OUTCOMES]
- 2026-03-01T18:22Z [CODE] Completion summaries.
```

### Entry Format

```
- YYYY-MM-DDTHH:MMZ [PROVENANCE] [plan:slug] <text>
```

| Field | Description | Required |
|---|---|---|
| Timestamp | ISO 8601 UTC, minute precision. Auto-generated. | Yes |
| Provenance | One of `USER`, `CODE`, `TOOL`, `ASSUMPTION`, `UNCONFIRMED` | Yes |
| Plan slug | Lowercase alphanumeric with dots/hyphens (e.g., `01-continuity-tool`) | No |
| Text | Single-line, non-blank, 1-400 characters | Yes |

## Usage

### Read Command

Returns the latest N bullet lines per section without modifying any files. Useful at the start of a session to load context.

```js
continuity({
  command: "read",
  read: {
    linesPerSection: 5,   // optional, default: 5
  },
})
```

**Output:** A text report with section headers in canonical order and the most recent bullet entries under each.

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

**Output:** A patch-style preview showing appended entries per section:

```
*** Begin Patch
*** Update File: docs/CONTINUITY.md
*** Summary: Updated 2 entries across 2 sections (PLANS, DECISIONS).
@@ ## [PLANS]
+- 2026-03-01T18:22Z [USER] [plan:01-continuity-tool] Implement continuity update tool with shared UTC timestamp.
@@ ## [DECISIONS]
+- 2026-03-01T18:22Z [CODE] Use a local .opencode tool with schema validation.
*** End Patch
```

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

### Compaction Object

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable/disable automatic compaction. |
| `upperTokenThreshold` | `integer` | `10000` | Token count that triggers compaction. |
| `lowerTokenThreshold` | `integer` | `upperTokenThreshold / 2` | Target token count after compaction. Must be exactly half of upper. |
| `totalTokenThreshold` | `integer` | -- | Legacy alias for `upperTokenThreshold`. |
| `encoding` | `string` | `"cl100k_base"` | tiktoken encoding name. |

### ReadConfig Object

| Field | Type | Default | Description |
|---|---|---|---|
| `linesPerSection` | `integer` | `5` | Number of most recent bullet lines to return per section. |

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
| `compaction` provided with `read` command | `compaction is not supported for read command` |
| Empty `updates` with `update` command | `updates must be provided for update command` |
| `lowerTokenThreshold` not half of upper | `lowerTokenThreshold must be half of upperTokenThreshold` |
| Missing `context.worktree` | `Missing worktree in tool context` |

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
| Read latest entries per section | Returns tail of each section without mutation |
| Skip compaction under threshold | No MEMORY.md created when under budget |
| Truncation and archival | Oldest entries removed, archived to MEMORY.md, tokens within budget |
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
  package.json
  bun.lock
```

## Roadmap

The compaction system is designed for incremental enhancement:

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | Done | Raw truncation with oldest-first removal and MEMORY.md archival |
| **Phase 2** | Planned | Generate `[THEMES]` and `[MILESTONES]` from compacted entries |
| **Phase 3** | Planned | Replace raw archived lines in MEMORY.md with grouped summaries |

## License

This project is private. See `package.json` for details.
