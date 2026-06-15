import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import tool, {
  deriveMemoryId,
  hashMemoryContent,
  normalizeMemoryContent,
  parseContinuityEntry,
} from "../src/continuity.js"

const tiktoken = await import("tiktoken")
const get_encoding =
  tiktoken.get_encoding ??
  tiktoken.default?.get_encoding ??
  tiktoken["module.exports"]?.get_encoding

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

const READ_FIXTURE = `# CONTINUITY

## [PLANS]
- 2026-02-01T00:00Z [USER] [plan:baseline] First plan entry.
- 2026-02-02T00:00Z [USER] [plan:baseline] Second plan entry.

## [DECISIONS]
- 2026-02-01T00:00Z [CODE] First decision entry.
- 2026-02-02T00:00Z [CODE] Second decision entry.

## [PROGRESS]
- 2026-02-01T00:00Z [TOOL] First progress entry.
- 2026-02-02T00:00Z [TOOL] Second progress entry.

## [DISCOVERIES]
- 2026-02-01T00:00Z [TOOL] First discovery entry.

## [OUTCOMES]
- 2026-02-01T00:00Z [CODE] First outcome entry.
`

const MIXED_READ_FIXTURE = `# CONTINUITY

## [PLANS]
- 2026-02-01T00:00Z [USER] [plan:baseline] Legacy plan entry.
- [id:plans-202602020000z-user-abcd1234ef56] 2026-02-02T00:00Z [USER] [plan:baseline] Id-prefixed plan entry.

## [DECISIONS]
- 2026-02-01T00:00Z [CODE] Legacy decision entry.

## [PROGRESS]
- [id:progress-202602020000z-tool-baadf00d1234] 2026-02-02T00:00Z [TOOL] Id-prefixed progress entry.

## [DISCOVERIES]
- 2026-02-01T00:00Z [TOOL] Legacy discovery entry.

## [OUTCOMES]
- [id:outcomes-202602020000z-code-deadbeef1234] 2026-02-02T00:00Z [CODE] Id-prefixed outcome entry.
`

const DUMMY_FIXTURE_PATH = path.join(
  process.cwd(),
  "docs",
  "CONTINUITY_DUMMY.md"
)

async function createTempWorktree() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "continuity-tool-"))
}

async function setupFixtureWorktree(fixtures) {
  const worktree = await createTempWorktree()
  await Promise.all(
    Object.entries(fixtures).map(async ([relativePath, content]) => {
      const targetPath = path.join(worktree, relativePath)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, content, "utf8")
    })
  )
  return worktree
}

async function readContinuity(worktree) {
  return await fs.readFile(
    path.join(worktree, "docs", "CONTINUITY.md"),
    "utf8"
  )
}

async function readMemory(worktree) {
  return await fs.readFile(path.join(worktree, "docs", "MEMORY.md"), "utf8")
}

async function readDummyFixture() {
  const content = await fs.readFile(DUMMY_FIXTURE_PATH, "utf8")
  if (content.includes("## [PLANS]")) {
    return content
  }
  return content.replace(
    /^\[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]$/gm,
    "## [$1]"
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

function getBulletLines(content, section) {
  return getSectionLines(content, section).filter((line) =>
    line.startsWith("- ")
  )
}

function countTotalTokens(content, encoder) {
  return encoder.encode(content).length
}

function expectSectionOrder(content) {
  const lines = content.split(/\r?\n/)
  const sections = [
    "PLANS",
    "DECISIONS",
    "PROGRESS",
    "DISCOVERIES",
    "OUTCOMES",
  ]
  const indexes = sections.map((section) => lines.indexOf(`## [${section}]`))
  indexes.forEach((index) => expect(index).toBeGreaterThanOrEqual(0))
  for (let i = 1; i < indexes.length; i += 1) {
    expect(indexes[i]).toBeGreaterThan(indexes[i - 1])
  }
}

function extractTimestamp(line) {
  const match = line.match(
    /^\- (?:\[id:[^\]]+\] )?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)/
  )
  if (!match) {
    throw new Error(`Missing timestamp in line: ${line}`)
  }
  return match[1]
}

function extractMemoryId(line) {
  const match = line.match(/^\- \[id:([^\]]+)\]/)
  if (!match) {
    throw new Error(`Missing memory ID in line: ${line}`)
  }
  return match[1]
}

describe("continuity", () => {
  it("appends entries after last bullet with shared timestamp", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })

    const result = await tool.execute(
      {
        command: "update",
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
    const planMemoryId = extractMemoryId(planLine)
    const decisionMemoryId = extractMemoryId(decisionLine)
    expect(planTimestamp).toBe(decisionTimestamp)
    expect(planTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/
    )
    expect(planMemoryId).toBe(
      deriveMemoryId({
        section: "PLANS",
        timestamp: planTimestamp,
        provenance: "USER",
        plan: "01-continuity-tool",
        text: "Sample continuity update via test.",
      })
    )
    expect(decisionMemoryId).toBe(
      deriveMemoryId({
        section: "DECISIONS",
        timestamp: decisionTimestamp,
        provenance: "CODE",
        text: "Sample decision entry from test.",
      })
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
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })

    await tool.execute(
      {
        command: "update",
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
        command: "update",
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
    const missingHeaderFixture = FIXTURE.replace("## [DISCOVERIES]\n\n", "")
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": missingHeaderFixture,
    })

    let error = null
    try {
      await tool.execute(
        {
          command: "update",
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
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })
    const before = await readContinuity(worktree)

    let error = null
    try {
      await tool.execute(
        {
          command: "update",
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

  it("rejects text that starts with a bracketed token without mutating the file", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })
    const before = await readContinuity(worktree)

    let error = null
    try {
      await tool.execute(
        {
          command: "update",
          updates: [
            {
              section: "PLANS",
              provenance: "USER",
              text: "[pin] Should be rejected.",
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
    expect(error?.message).toContain("text must not start with a bracketed token")
    expect(after).toBe(before)
  })

  it("parses legacy and id-prefixed continuity entries", () => {
    const legacyLine =
      "- 2026-02-01T00:00Z [USER] [plan:baseline] Legacy plan entry."
    const idLine =
      "- [id:plans-202602020000z-user-abcd1234ef56] 2026-02-02T00:00Z [USER] [plan:baseline] [pin] Id-prefixed plan entry."

    const legacyEntry = parseContinuityEntry(legacyLine, "PLANS")
    const idEntry = parseContinuityEntry(idLine, "PLANS")

    expect(legacyEntry).not.toBeNull()
    expect(legacyEntry?.isLegacy).toBe(true)
    expect(legacyEntry?.provenance).toBe("USER")
    expect(legacyEntry?.plan).toBe("baseline")
    expect(legacyEntry?.text).toBe("Legacy plan entry.")
    expect(legacyEntry?.memoryId).toBe(
      deriveMemoryId({
        section: "PLANS",
        timestamp: "2026-02-01T00:00Z",
        provenance: "USER",
        plan: "baseline",
        text: "Legacy plan entry.",
      })
    )

    expect(idEntry).not.toBeNull()
    expect(idEntry?.isLegacy).toBe(false)
    expect(idEntry?.memoryId).toBe(
      "plans-202602020000z-user-abcd1234ef56"
    )
    expect(idEntry?.pinned).toBe(true)
    expect(idEntry?.text).toBe("Id-prefixed plan entry.")
  })

  it("parses status and preserves unknown leading tokens as text", () => {
    const line =
      "- [id:plans-202602020000z-user-abcd1234ef56] 2026-02-02T00:00Z [USER] [foo] [status:active] [pin] Parsed text."

    const entry = parseContinuityEntry(line, "PLANS")

    expect(entry).not.toBeNull()
    expect(entry?.provenance).toBe("USER")
    expect(entry?.status).toBe("active")
    expect(entry?.pinned).toBe(true)
    expect(entry?.text).toBe("[foo] Parsed text.")
  })

  it("returns null for malformed continuity lines", () => {
    expect(parseContinuityEntry("Not a bullet", "PLANS")).toBeNull()
    expect(parseContinuityEntry("- No timestamp here", "PLANS")).toBeNull()
  })

  it("normalizes and hashes memory content deterministically", () => {
    const first = "  Same   content\r\nwith spacing  "
    const second = "Same content\nwith spacing"

    expect(normalizeMemoryContent(first)).toBe("Same content with spacing")
    expect(normalizeMemoryContent(second)).toBe("Same content with spacing")
    expect(hashMemoryContent(first)).toBe(hashMemoryContent(second))
    expect(hashMemoryContent(first)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("derives deterministic memory ids for sparse inputs", () => {
    const memoryId = deriveMemoryId({
      section: null,
      timestamp: undefined,
      provenance: null,
      plan: null,
      text: "x",
    })

    expect(memoryId).toBe(deriveMemoryId({
      section: null,
      timestamp: undefined,
      provenance: null,
      plan: null,
      text: "x",
    }))
    expect(memoryId).toMatch(/^entry-undated-unknown-[0-9a-f]{12}$/)
  })

  it("accepts plan slugs containing dots when generating ids", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })

    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PLANS",
            provenance: "USER",
            plan: "04.layered-memory",
            text: "Plan slug with dot support.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    expect(content).toContain("[plan:04.layered-memory] Plan slug with dot support.")
    expect(content).toContain("[id:")
  })

  it("reads latest entries per section without mutating file", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": READ_FIXTURE,
    })
    const before = await readContinuity(worktree)

    const output = await tool.execute(
      {
        command: "read",
        read: {
          linesPerSection: 1,
        },
      },
      { worktree }
    )

    expect(output).toContain("## [PLANS]")
    expect(output).toContain("Second plan entry.")
    expect(output).not.toContain("First plan entry.")
    expect(output).toContain("## [DECISIONS]")
    expect(output).toContain("Second decision entry.")
    expect(output).not.toContain("First decision entry.")
    expect(output).toContain("## [PROGRESS]")
    expect(output).toContain("Second progress entry.")
    expect(output).not.toContain("First progress entry.")
    expect(output).toContain("## [DISCOVERIES]")
    expect(output).toContain("First discovery entry.")
    expect(output).toContain("## [OUTCOMES]")
    expect(output).toContain("First outcome entry.")

    const after = await readContinuity(worktree)
    expect(after).toBe(before)
  })

  it("reads mixed legacy and id-prefixed entries without mutating file", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": MIXED_READ_FIXTURE,
    })
    const before = await readContinuity(worktree)

    const output = await tool.execute(
      {
        command: "read",
        read: {
          linesPerSection: 2,
        },
      },
      { worktree }
    )

    expect(output).toContain("Legacy plan entry.")
    expect(output).toContain("[id:plans-202602020000z-user-abcd1234ef56]")
    expect(output).toContain("Id-prefixed progress entry.")
    expect(output).toContain("Legacy discovery entry.")

    const after = await readContinuity(worktree)
    expect(after).toBe(before)
  })

  it("ignores compaction args when reading", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": READ_FIXTURE,
    })
    const before = await readContinuity(worktree)

    const output = await tool.execute(
      {
        command: "read",
        compaction: {
          enabled: false,
          upperTokenThreshold: 10000,
          lowerTokenThreshold: 5000,
          totalTokenThreshold: 10000,
          encoding: "cl100k_base",
        },
        read: {
          linesPerSection: 1,
        },
      },
      { worktree }
    )

    expect(output).toContain("## [PLANS]")
    expect(output).toContain("Second plan entry.")

    const after = await readContinuity(worktree)
    expect(after).toBe(before)
  })

  it("ignores read args when updating", async () => {
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": FIXTURE,
    })

    const result = await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Update should ignore read args.",
          },
        ],
        read: {
          linesPerSection: 5,
        },
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    expect(content).toContain("Update should ignore read args.")
    expect(result).toContain("Update should ignore read args.")
  })

  it("skips compaction when under upper threshold", async () => {
    const fixture = await readDummyFixture()
    const encoder = get_encoding("cl100k_base")
    const totalTokens = countTotalTokens(fixture, encoder)
    encoder.free()
    const upperThreshold = totalTokens + 1000
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": fixture,
    })

    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PLANS",
            provenance: "TOOL",
            text: "No-op compaction test update.",
          },
        ],
        compaction: {
          upperTokenThreshold: upperThreshold,
        },
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    expect(content).toContain("No-op compaction test update.")
    expect(content).not.toContain("Compaction triggered")
    expectSectionOrder(content)

    let memoryError = null
    try {
      await readMemory(worktree)
    } catch (error) {
      memoryError = error
    }
    expect(memoryError).not.toBeNull()
  })

  it("truncates over-limit sections and archives removed lines", async () => {
    const fixture = await readDummyFixture()
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": fixture,
    })

    const firstPlanEntry = getBulletLines(fixture, "PLANS")[0]

    const encoder = get_encoding("cl100k_base")
    const fixtureTokens = countTotalTokens(fixture, encoder)
    encoder.free()
    const upperThreshold = 10000
    const lowerThreshold = 5000
    expect(fixtureTokens).toBeGreaterThan(upperThreshold)
    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Trigger compaction with update.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const memory = await readMemory(worktree)
    const resultEncoder = get_encoding("cl100k_base")
    const totalTokens = countTotalTokens(content, resultEncoder)
    resultEncoder.free()

    expect(content).toContain("Compaction triggered")
    expect(content).not.toContain(firstPlanEntry)
    expect(memory).toContain(firstPlanEntry)
    expect(totalTokens).toBeLessThanOrEqual(lowerThreshold)
    expectSectionOrder(content)
    expectSectionOrder(memory)
  })

  it("compacts mixed legacy and id-prefixed entries", async () => {
    const baseFixture = await readDummyFixture()
    const fixture = baseFixture.replace(
      "## [DECISIONS]",
      "- [id:plans-202602020000z-user-abcd1234ef56] 2026-02-02T00:00Z [USER] [plan:baseline] Id-prefixed extra plan entry.\n\n## [DECISIONS]"
    )
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": fixture,
    })

    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Trigger compaction with mixed entry formats.",
          },
        ],
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const memory = await readMemory(worktree)

    expect(content).toContain("Compaction triggered")
    expect(memory).toMatch(/- (?:\[id:[^\]]+\] )?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/)
  })

  it("normalizes mismatched lower threshold to half of upper", async () => {
    const fixture = await readDummyFixture()
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": fixture,
    })

    const upperThreshold = 10000
    const derivedLowerThreshold = 5000

    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Trigger compaction with mismatched lower threshold.",
          },
        ],
        compaction: {
          upperTokenThreshold: upperThreshold,
          lowerTokenThreshold: 4000,
        },
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const encoder = get_encoding("cl100k_base")
    const totalTokens = countTotalTokens(content, encoder)
    encoder.free()

    expect(content).toContain("Compaction triggered")
    expect(totalTokens).toBeLessThanOrEqual(derivedLowerThreshold)
  })

  it("truncates oldest lines first when legacy total threshold exceeded", async () => {
    const fixture = await readDummyFixture()
    const encoder = get_encoding("cl100k_base")
    const totalTokens = countTotalTokens(fixture, encoder)
    encoder.free()

    const totalThreshold = totalTokens - 1000
    const worktree = await setupFixtureWorktree({
      "docs/CONTINUITY.md": fixture,
    })

    const firstPlansEntry = getBulletLines(fixture, "PLANS")[0]

    await tool.execute(
      {
        command: "update",
        updates: [
          {
            section: "PROGRESS",
            provenance: "TOOL",
            text: "Trigger truncation for oldest-first test.",
          },
        ],
        compaction: {
          totalTokenThreshold: totalThreshold,
        },
      },
      { worktree }
    )

    const content = await readContinuity(worktree)
    const memory = await readMemory(worktree)

    expect(content).not.toContain(firstPlansEntry)
    expect(memory).toContain(firstPlansEntry)
  })
})
