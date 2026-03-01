# Continuity Update Tool

## Purpose
Provide a repo-local OpenCode custom tool that updates `docs/CONTINUITY.md` with validated entries using a single shared UTC timestamp for each invocation.

## Tool location and name
- File: `.opencode/tools/continuity_update.ts`
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
})
```

## Expected output example
```
- 2026-03-01T18:22Z [USER] [plan:01-continuity-tool] Implement continuity update tool with shared UTC timestamp.
```

## Validation commands (non-interactive)
- `rg -n "^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]" docs/CONTINUITY.md`
- `rg -n "^\- [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z" docs/CONTINUITY.md`
