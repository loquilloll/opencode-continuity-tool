---
plan_type: build
---

# Continuity Command + Read Plan

## Goal
Add a command-style continuity tool that supports both update and read modes, return the latest N lines per section on read, and rename the tool entrypoint to `continuity.js`.

## Requirements (from user)
- The tool must support read mode that returns lines from each section with configurable N (latest lines per section).
- The tool must use a command-style switch between read and update modes.
- Rename the tool file/name to `continuity.js` (hard rename; no compatibility alias).

## Constraints
- Read mode must be non-mutating (no writes, no file creation).
- Update mode must preserve current behavior (validation, shared timestamp, compaction, patch-style output).
- Non-interactive commands only.
- ASCII-only edits.

## Command interface
- `command`: enum `read` | `update` (required).
- Update arguments:
  - `updates`: array of update entries (required when `command: "update"`).
  - `compaction`: existing compaction config (optional, update-only).
- Read arguments:
  - `read.linesPerSection`: positive integer (optional, default 5).

## Output
- Update command: return existing patch-style preview (unchanged format).
- Read command: return a text report with section headers in canonical order and the latest `linesPerSection` bullet lines under each header.

## Implementation steps
1. Replace `src/continuity_update.ts` with `src/continuity.js`.
   - Port existing update/compaction logic to JS (remove TS types).
   - Add a command dispatcher: `read` and `update`.
2. Implement read mode.
   - Parse `docs/CONTINUITY.md` without mutating it.
   - For each section, return the last N bullet lines.
   - Reject invalid inputs (non-integer or <= 0 line counts).
3. Update tests.
   - Rename `tests/continuity_update.test.js` to `tests/continuity.test.js`.
   - Update update tests to include `command: "update"`.
   - Add read tests for tail behavior and non-mutating guarantees.
4. Update docs.
   - `docs/continuity-tool.md` to reflect new tool name/path and read usage.
   - Optional: align `docs/plans/01-continuity-tool.md` naming references.

## Validation
- `bun test tests/continuity.test.js`
- Verify read output shows latest entries per section with `linesPerSection` overrides.

## Acceptance criteria
- `continuity` tool supports `command: "read"` and `command: "update"`.
- Read mode returns the latest N bullet lines per section without writing files.
- Update mode behavior is unchanged aside from the command wrapper.
- Tool entrypoint is `src/continuity.js` and `continuity_update` is removed.
