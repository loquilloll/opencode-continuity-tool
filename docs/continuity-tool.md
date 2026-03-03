# Continuity Update Tool

## Purpose
Provide a repo-local OpenCode custom tool that updates `docs/CONTINUITY.md` with validated entries using a single shared UTC timestamp for each invocation.

## Tool location and name
- Tool implementation: `src/continuity_update.ts`
- Tool name: `continuity_update`

## Entry format
```
- YYYY-MM-DDTHH:MMZ [PROVENANCE] [plan:slug] <text>
```
- The `[plan:slug]` segment is optional.

## Allowed values and validation
- Section: `PLANS`, `DECISIONS`, `PROGRESS`, `DISCOVERIES`, `OUTCOMES`.
- Provenance: `USER`, `CODE`, `TOOL`, `ASSUMPTION`, `UNCONFIRMED`.
- `plan` slug: lowercase alphanumeric, dot, or hyphen (regex: `^[a-z0-9][a-z0-9.-]*$`).
- `text` must be single-line, non-blank, and 1 to 400 characters.

## Behavior
- Uses one UTC timestamp for all entries in a single call.
- Appends new entries after the last bullet in each target section.
- Creates `docs/CONTINUITY.md` from a template if missing.
- Errors on missing or duplicate section headers.
- Returns a patch-style preview that lists appended entries per section.
- When compaction is enabled, it triggers on the upper token threshold and truncates oldest entries to the lower target, archiving removed lines in `docs/MEMORY.md`.
- Truncation honors per-section ratio weights (derived from CONTINUITY_DUMMY.md) by trimming oldest entries within each section to match the ratio-based token budgets.
- Logs a compaction entry in `DISCOVERIES` when truncation occurs.

## Compaction configuration
Compaction settings are provided via the optional `compaction` argument.

Defaults:
- `enabled`: `true`
- `upperTokenThreshold`: `10000`
- `lowerTokenThreshold`: half of `upperTokenThreshold` (default `5000`)
- `encoding`: `cl100k_base`
Compaction triggers when total tokens in the entire document exceed the upper threshold and truncates until the total is at or below the lower threshold.
`lowerTokenThreshold` is derived as half of `upperTokenThreshold` and must match that value if provided.
Legacy `totalTokenThreshold` is accepted; when `upperTokenThreshold`/`lowerTokenThreshold` are not provided it maps to the upper threshold and derives the lower threshold as half.

## MEMORY.md role
`docs/MEMORY.md` is archival only and is not a source of truth. In Phase 1 compaction, the tool appends raw truncated lines under their original sections. `THEMES` and `MILESTONES` headers are reserved for later phases.

## Sample usage
```ts
continuity_update({
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
  compaction: {
    upperTokenThreshold: 10000,
  },
})
```

## Expected output example
```
- 2026-03-01T18:22Z [USER] [plan:01-continuity-tool] Implement continuity update tool with shared UTC timestamp.
```

## Validation commands (non-interactive)
- `rg -n "^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]" docs/CONTINUITY.md`
- `rg -n "^\- [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z" docs/CONTINUITY.md`
