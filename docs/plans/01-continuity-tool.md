---
plan_type: build
---

# Continuity Tool Build Plan

## Goal
Implement a repo-local OpenCode custom tool that updates `docs/CONTINUITY.md` using a single shared UTC timestamp across all entries created in one call, while allowing multi-section updates and enforcing canonical entry formatting.

## Constraints
- Repo-local tool only (no global config writes).
- Non-interactive commands only.
- Canonical entry format: `YYYY-MM-DDTHH:MMZ [PROVENANCE] [plan:slug?] <text>`.
- Validate section names and provenance values; reject multi-line/raw log text.
- Support multiple section updates in one invocation.
- Auto-stamp current UTC time (no user-provided date).

## Config wiring (per https://opencode.ai/docs/custom-tools/)
- Tool location: `.opencode/tools/continuity_update.ts` (local project tool).
- Tool name: `continuity_update` (file name becomes tool name).
- Use `tool()` from `@opencode-ai/plugin` and `tool.schema` (Zod) for validation.
- Resolve the worktree path with `context.worktree` and target file `docs/CONTINUITY.md`.

## Tool interface schema
```ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Update docs/CONTINUITY.md with validated, timestamped entries",
  args: {
    updates: tool.schema
      .array(
        tool.schema.object({
          section: tool.schema.enum([
            "PLANS",
            "DECISIONS",
            "PROGRESS",
            "DISCOVERIES",
            "OUTCOMES",
          ]),
          provenance: tool.schema.enum([
            "USER",
            "CODE",
            "TOOL",
            "ASSUMPTION",
            "UNCONFIRMED",
          ]),
          plan: tool.schema
            .string()
            .regex(/^[a-z0-9][a-z0-9.-]*$/)
            .optional(),
          text: tool.schema.string().min(1).max(400),
        })
      )
      .min(1),
  },
  async execute(args, context) {
    // Implementation in Phase 1
  },
})
```

## Script outline
```ts
// 1) Compute a single UTC timestamp for this invocation
const timestamp = new Date().toISOString().slice(0, 16) + "Z"

// 2) Validate inputs beyond schema
// - text must be single-line (no \n or \r)
// - optional plan slug already regex-validated

// 3) Ensure docs/CONTINUITY.md exists with canonical section headers
//    If missing, create a template with:
//    # CONTINUITY
//    ## [PLANS]
//    ## [DECISIONS]
//    ## [PROGRESS]
//    ## [DISCOVERIES]
//    ## [OUTCOMES]

// 4) Read file and locate each section by header
//    Example header pattern: /^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]\s*$/

// 5) Build entry lines using the shared timestamp
//    - `- ${timestamp} [${provenance}] [plan:${plan}] ${text}` (plan segment optional)

// 6) Append new entries after the last bullet in each section
//    Preserve section order and spacing

// 7) Write file and return a concise summary
```

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
      text: "Use a local .opencode tool with schema validation and single-line entries.",
    },
  ],
})
```

## Phases

### Phase/Commit 1: Core tool + continuity template
Scope
- Add the custom tool in `.opencode/tools/continuity_update.ts`.
- Ensure `docs/CONTINUITY.md` template exists (create if missing) with required sections.

Files
- `.opencode/tools/continuity_update.ts`
- `docs/CONTINUITY.md`

Implementation
- Implement schema validation and extra checks (single-line `text`, valid `plan` slug).
- Compute a shared UTC timestamp once per invocation.
- Read/parse `docs/CONTINUITY.md` and append entries after the last bullet in each section.
- Create template if file is missing to guarantee section headers.
- Return a summary string (sections updated + entry count).

Validation
- Invoke tool with multi-section updates and verify entries share the same timestamp.
- Confirm rejection of multi-line `text` and invalid `section`/`provenance` values.

Suggested commit message
- `feat: add continuity update tool with shared timestamp`

### Phase/Commit 2: Guardrails + usage docs
Scope
- Add lightweight usage notes and examples for the tool.
- Add a simple validation checklist or script if needed.

Files
- `docs/README.md` (or new `docs/continuity-tool.md` if preferred)

Implementation
- Document canonical entry format and allowed provenance values.
- Provide sample tool invocation and expected file output.
- Note that timestamps are auto-generated and shared across entries.

Validation
- Review docs for accuracy and consistency with tool behavior.

Suggested commit message
- `docs: add continuity tool usage notes`

## Testing plan
- Test setup: use a fixture `docs/CONTINUITY.md` with all five sections and existing bullets; include a missing-file case.
- Integration (happy path): multi-section update verifies shared timestamp, optional `[plan:slug]`, and append-after-last-bullet behavior.
- Ordering: multiple updates targeting the same section append in input order.
- Validation failures: reject invalid `section`/`provenance`, invalid `plan` slug, empty updates, multiline `text`, and overlong `text`; file remains unchanged.
- File handling: missing `docs/CONTINUITY.md` triggers template creation; missing section header should fail with a clear error.
- Format sanity: regex-check new entries match the canonical pattern and no blank lines are inserted inside sections.

## Validation commands (non-interactive)
- Use OpenCode to call `continuity_update` with multi-section input and verify output in `docs/CONTINUITY.md`.
- `rg -n "^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]" docs/CONTINUITY.md`
- `rg -n "^\- [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z" docs/CONTINUITY.md`
