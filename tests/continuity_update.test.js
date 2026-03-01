import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import tool from "../.opencode/tools/continuity_update.ts"

const FIXTURE = `# CONTINUITY

## [PLANS]
- 2026-02-01T00:00Z [USER] [plan:baseline] Existing plan entry.

## [DECISIONS]
- 2026-02-01T00:00Z [CODE] Existing decision entry.

## [PROGRESS]
- 2026-02-01T00:00Z [TOOL] Existing progress entry.

## [DISCOVERIES]

## [OUTCOMES]
`

async function createTempWorktree() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "continuity-tool-"))
}

async function writeContinuity(worktree, content) {
  const docsPath = path.join(worktree, "docs")
  await fs.mkdir(docsPath, { recursive: true })
  await fs.writeFile(path.join(docsPath, "CONTINUITY.md"), content, "utf8")
}

async function readContinuity(worktree) {
  return await fs.readFile(
    path.join(worktree, "docs", "CONTINUITY.md"),
    "utf8"
  )
}

function getSectionLines(content, section) {
  const lines = content.split(/\r?\n/)
  const header = `## [${section}]`
  const startIndex = lines.indexOf(header)
  if (startIndex === -1) {
    throw new Error(`Missing header: ${section}`)
  }
  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## [")) {
      endIndex = i
      break
    }
  }
  return lines.slice(startIndex + 1, endIndex)
}

function extractTimestamp(line) {
  const match = line.match(/^\- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)/)
  if (!match) {
    throw new Error(`Missing timestamp in line: ${line}`)
  }
  return match[1]
}

describe("continuity_update", () => {
  it("appends entries after last bullet with shared timestamp", async () => {
    const worktree = await createTempWorktree()
    await writeContinuity(worktree, FIXTURE)

    const result = await tool.execute(
      {
        updates: [
          {
            section: "PLANS",
            provenance: "USER",
            plan: "01-continuity-tool",
            text: "Sample continuity update via test.",
          },
          {
            section: "DECISIONS",
            provenance: "CODE",
            text: "Sample decision entry from test.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const plans = getSectionLines(content, "PLANS")
    const decisions = getSectionLines(content, "DECISIONS")

    const planExistingIndex = plans.findIndex((line) =>
      line.includes("Existing plan entry.")
    )
    const planNewIndex = plans.findIndex((line) =>
      line.includes("Sample continuity update via test.")
    )
    expect(planExistingIndex).toBeGreaterThanOrEqual(0)
    expect(planNewIndex).toBeGreaterThan(planExistingIndex)

    const decisionExistingIndex = decisions.findIndex((line) =>
      line.includes("Existing decision entry.")
    )
    const decisionNewIndex = decisions.findIndex((line) =>
      line.includes("Sample decision entry from test.")
    )
    expect(decisionExistingIndex).toBeGreaterThanOrEqual(0)
    expect(decisionNewIndex).toBeGreaterThan(decisionExistingIndex)

    const planLine = plans[planNewIndex]
    const decisionLine = decisions[decisionNewIndex]
    const planTimestamp = extractTimestamp(planLine)
    const decisionTimestamp = extractTimestamp(decisionLine)
    expect(planTimestamp).toBe(decisionTimestamp)
    expect(planTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/
    )
    expect(result).toContain("*** Begin Patch")
    expect(result).toContain("*** Update File: docs/CONTINUITY.md")
    expect(result).toContain("@@ ## [PLANS]")
    expect(result).toContain("@@ ## [DECISIONS]")
    expect(result).toContain("Sample continuity update via test.")
    expect(result).toContain("Sample decision entry from test.")
    expect(result).toContain("*** End Patch")
  })

  it("preserves input order for multiple entries in one section", async () => {
    const worktree = await createTempWorktree()
    await writeContinuity(worktree, FIXTURE)

    await tool.execute(
      {
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "First progress entry.",
          },
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Second progress entry.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const progress = getSectionLines(content, "PROGRESS")

    const firstIndex = progress.findIndex((line) =>
      line.includes("First progress entry.")
    )
    const secondIndex = progress.findIndex((line) =>
      line.includes("Second progress entry.")
    )

    expect(firstIndex).toBeGreaterThanOrEqual(0)
    expect(secondIndex).toBeGreaterThan(firstIndex)
  })

  it("creates continuity file when missing", async () => {
    const worktree = await createTempWorktree()

    await tool.execute(
      {
        updates: [
          {
            section: "PLANS",
            provenance: "USER",
            text: "Created from missing file.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    expect(content).toContain("## [PLANS]")
    expect(content).toContain("## [DECISIONS]")
    expect(content).toContain("## [PROGRESS]")
    expect(content).toContain("## [DISCOVERIES]")
    expect(content).toContain("## [OUTCOMES]")
    expect(content).toContain("Created from missing file.")
  })

  it("fails when a required section header is missing", async () => {
    const worktree = await createTempWorktree()
    const missingHeaderFixture = FIXTURE.replace("## [DISCOVERIES]\n\n", "")
    await writeContinuity(worktree, missingHeaderFixture)

    let error = null
    try {
      await tool.execute(
        {
          updates: [
            {
              section: "PLANS",
              provenance: "USER",
              text: "Should fail on missing header.",
            },
          ],
        },
        { worktree }
      )
    } catch (caught) {
      error = caught
    }

    const content = await readContinuity(worktree)
    expect(error).not.toBeNull()
    expect(error?.message).toContain("Missing section header(s): DISCOVERIES")
    expect(content).toBe(missingHeaderFixture)
  })

  it("rejects multi-line text without mutating the file", async () => {
    const worktree = await createTempWorktree()
    await writeContinuity(worktree, FIXTURE)
    const before = await readContinuity(worktree)

    let error = null
    try {
      await tool.execute(
        {
          updates: [
            {
              section: "PLANS",
              provenance: "USER",
              text: "Line one.\nLine two.",
            },
          ],
        },
        { worktree }
      )
    } catch (caught) {
      error = caught
    }

    const after = await readContinuity(worktree)
    expect(error).not.toBeNull()
    expect(error?.message).toContain("text must be a single line")
    expect(after).toBe(before)
  })
})
