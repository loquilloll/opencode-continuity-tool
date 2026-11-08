---
name: continuity
description: Use the continuity tool to stay aligned with work already done on this branch, and to record deliberate findings for later sessions and subagents. Trigger at the START of any task in a repository where the continuity plugin is installed (read before exploring code), when resuming interrupted work, when asked about current state/direction/progress of a feature, after making a meaningful decision, discovery, or course change worth remembering, before handing off or declaring a task done, and when spawning subagents that should know the branch's context. Also triggers on the words "continuity", "briefing", "what was I doing", "where did we leave off". Do NOT hand-edit continuity files; this skill defines the only supported workflow.
---

# Continuity

Continuity is a branch-scoped briefing shared by every agent (primary and subagents) working on the same branch, plus a repository-wide layer of distilled durable knowledge. It survives session restarts and context compaction. All of it lives in uncommitted Markdown under the repo's Git metadata — never in tracked files.

**Load this skill before your first continuity call in a session.** The tool description covers arguments; this skill covers *when* and *what* — the discipline that makes the briefing worth reading.

## When to use

**Read first, before acting.** At the start of a task, call `read` before exploring code — it tells you the branch's direction, what's done, and what tripped others up. It is the cheapest orientation signal available.

Read again when:
- resuming after an interruption, compaction, or restart;
- you're unsure whether something was already tried or decided;
- a user asks about the state, direction, or progress of the current work;
- you're about to spawn a subagent and want to brief it (or it will read the same branch itself).

**When grep can't help, search.** Continuity memory is invisible to file searches (it lives under Git metadata), so when hunting for prior context — "did we already handle X?", "what was that codename/flag/error?" — use `search` instead of ripgrep, then retrieve hits with `read.memoryId`. Search covers every entry ever recorded, including entries that aged out of `read`'s bounded window and entries already distilled into shared knowledge.

**Update on meaningful delta only.** After a decision, discovery, course change, or completion — not after every tool call. One update call may carry several entries.

**Update before declaring done.** A task isn't finished until its outcome is recorded (see Definition of Done below).

## How: the only supported workflow

All commands go through the `continuity` tool. Never write the store files directly — hand edits can corrupt fencing/revision state and will be rejected or, worse, block the store.

- **search** — look back beyond what `read` returns. The store lives under Git metadata, invisible to grep/ripgrep, and `read` is bounded to recent/unseen entries — but every deliberate entry is retained forever. `search` finds them by substring (current branch + shared knowledge by default; `all: true` sweeps every branch in the repository, results labeled by branch). Returns memory IDs; retrieve same-branch or shared hits with `read.memoryId`, and hits labeled with another branch with `read` plus that `branch` selector and `read.memoryId`.
- **read** — bounded view: shared knowledge + this branch's checkpoint + new entries. Default mode is `delta`, which needs `sessionId` (use the current session's id; repeat calls return only what's new). Use `mode: "tail"` for a quick latest-entries look without a sessionId. If a `[Blocked memory …]` marker appears, use `read.memoryId` for that entry.
- **update** — submit deliberate entries. Each entry: `section`, `provenance`, `text` (single line, ≤400 chars), optional `plan` slug. Timestamps and IDs are assigned for you.
- **status** — pending distillation work, last errors, config, branch attribution. Use it when something seems stuck or before reporting state.
- **distill** — force an immediate distillation run (plugin only). Rarely needed; automatic runs happen on their own schedule.

**Branch attribution is automatic.** Omit the `branch` argument entirely — it exists for intentional cross-branch reads only. Never guess branch names; a wrong guess silently reads an empty namespace.

## What goes in each section

- `[PLANS]` — what you (or the next contributor) intend to do next; checklists.
- `[DECISIONS]` — choices made and their rationale.
- `[PROGRESS]` — course changes and *why* the plan deviated.
- `[DISCOVERIES]` — notable behaviors, tradeoffs, bugs, inverse/unapply semantics. Short evidence beats prose (a failing test's output line is ideal).
- `[OUTCOMES]` — completion summary: achieved, remaining, lessons.

## Anti-drift rules (adopted from the legacy global instructions)

- **Facts only.** No transcripts, no raw logs, no ventriloquizing the user.
- **Provenance on every entry**: `USER` (user said it), `CODE` (verified in code), `TOOL` (a tool reported it), `ASSUMPTION` (unverified reasoning), `UNCONFIRMED` (unknown — never guess). Tag the worst case, not the hopeful one.
- **Link plans**: entries tied to a numbered plan add `[plan:<slug>]` after the provenance tag.
- **Supersede, don't rewrite history**: a changed decision gets a new entry that names what it supersedes.
- **Deliberate entries only.** Never dump conversation content — distillation consumes submitted entries, not transcripts; anything you didn't submit will not be remembered.

## Sharing and distillation

- Everything you submit is visible to every agent on this branch, in any checkout of it. Other branches see only the distilled shared layer.
- Distillation is automatic on a configured interval (default ~3 runs per working day). Do not wait for it, and do not treat a not-yet-distilled entry as shared knowledge — it's branch-local until promoted.
- Durable, repo-wide facts get promoted automatically (with citations back to your entries). Branch progress, blockers, and unverified claims stay branch-local by design. If a promotion would contradict existing shared knowledge, a conflict is recorded for human resolution — check `status` for unresolved conflicts.

## Definition of Done (continuity portion)

A task is done only when the outcome is recorded: one `[OUTCOMES]` entry (achieved/remaining/lessons) plus any `[DECISIONS]`/`[DISCOVERIES]` entries the task produced. If nothing about the state changed, no update is needed.

## If something goes wrong

- Tool missing → the plugin isn't installed; say so and continue without it. Do not recreate store files by hand.
- `status` shows an error → report it; the store preserves pending entries across failures by design.
- Non-Git directory → only legacy read/update work; targeted reads/status/distill need the plugin's transactional store.
