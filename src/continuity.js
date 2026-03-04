import { tool } from "@opencode-ai/plugin"
import fs from "fs/promises"
import path from "path"
import { get_encoding } from "tiktoken"

const SECTIONS = [
  "PLANS",
  "DECISIONS",
  "PROGRESS",
  "DISCOVERIES",
  "OUTCOMES",
]

const PROVENANCE = [
  "USER",
  "CODE",
  "TOOL",
  "ASSUMPTION",
  "UNCONFIRMED",
]

const DEFAULT_UPPER_TOKEN_THRESHOLD = 10000
const DEFAULT_ENCODING = "cl100k_base"
const DEFAULT_READ_LINES_PER_SECTION = 5

const SECTION_RATIO_WEIGHTS = {
  PLANS: 4339,
  DECISIONS: 5175,
  PROGRESS: 22471,
  DISCOVERIES: 6622,
  OUTCOMES: 9126,
}
const SECTION_RATIO_TOTAL = Object.values(SECTION_RATIO_WEIGHTS).reduce(
  (sum, value) => sum + value,
  0
)

const TEMPLATE = `# CONTINUITY

## [PLANS]

## [DECISIONS]

## [PROGRESS]

## [DISCOVERIES]

## [OUTCOMES]
`

const MEMORY_TEMPLATE = `# MEMORY

## [PLANS]

## [DECISIONS]

## [PROGRESS]

## [DISCOVERIES]

## [OUTCOMES]

## [THEMES]

## [MILESTONES]
`

const HEADER_PATTERN =
  /^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]\s*$/

function validateText(text) {
  if (text.includes("\n") || text.includes("\r")) {
    throw new Error("text must be a single line")
  }
  if (text.trim().length === 0) {
    throw new Error("text must not be blank")
  }
}

function buildEntry(timestamp, update) {
  const planSegment = update.plan ? ` [plan:${update.plan}]` : ""
  return `- ${timestamp} [${update.provenance}]${planSegment} ${update.text}`
}

function resolveCompactionConfig(input) {
  const enabled = input?.enabled ?? true
  const hasUpper = typeof input?.upperTokenThreshold === "number"
  const hasLower = typeof input?.lowerTokenThreshold === "number"
  const hasLegacy = typeof input?.totalTokenThreshold === "number"

  let upperTokenThreshold = DEFAULT_UPPER_TOKEN_THRESHOLD
  if (hasUpper) {
    upperTokenThreshold = input?.upperTokenThreshold ?? upperTokenThreshold
  } else if (hasLegacy) {
    upperTokenThreshold = input?.totalTokenThreshold ?? upperTokenThreshold
  } else if (hasLower) {
    upperTokenThreshold = (input?.lowerTokenThreshold ?? 0) * 2
  }

  const derivedLowerTokenThreshold = Math.max(
    1,
    Math.floor(upperTokenThreshold / 2)
  )
  if (hasLower && input?.lowerTokenThreshold !== derivedLowerTokenThreshold) {
    throw new Error("lowerTokenThreshold must be half of upperTokenThreshold")
  }
  const lowerTokenThreshold = derivedLowerTokenThreshold

  if (!Number.isInteger(upperTokenThreshold) || upperTokenThreshold <= 0) {
    throw new Error("upperTokenThreshold must be a positive integer")
  }
  if (!Number.isInteger(lowerTokenThreshold) || lowerTokenThreshold <= 0) {
    throw new Error("lowerTokenThreshold must be a positive integer")
  }
  if (lowerTokenThreshold > upperTokenThreshold) {
    throw new Error(
      "lowerTokenThreshold must be less than or equal to upperTokenThreshold"
    )
  }

  return {
    enabled,
    upperTokenThreshold,
    lowerTokenThreshold,
    encoding: input?.encoding ?? DEFAULT_ENCODING,
  }
}

function resolveReadConfig(read) {
  const linesPerSection =
    read?.linesPerSection ?? DEFAULT_READ_LINES_PER_SECTION
  if (!Number.isInteger(linesPerSection) || linesPerSection <= 0) {
    throw new Error("read.linesPerSection must be a positive integer")
  }
  return { linesPerSection }
}

function findSectionIndexes(lines) {
  const indexBySection = new Map()

  lines.forEach((line, index) => {
    const match = line.match(HEADER_PATTERN)
    if (!match) return

    const section = match[1]
    if (indexBySection.has(section)) {
      throw new Error(`Duplicate section header: ${section}`)
    }
    indexBySection.set(section, index)
  })

  const missing = SECTIONS.filter((section) => !indexBySection.has(section))
  if (missing.length > 0) {
    throw new Error(`Missing section header(s): ${missing.join(", ")}`)
  }

  return indexBySection
}

function getSectionBoundaries(lines) {
  const sectionIndexes = findSectionIndexes(lines)
  const boundaries = SECTIONS.map((section) => {
    const startIndex = sectionIndexes.get(section) ?? 0
    let endIndex = lines.length
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      if (lines[i].startsWith("## [")) {
        endIndex = i
        break
      }
    }
    return { section, startIndex, endIndex }
  })
  boundaries.sort((a, b) => a.startIndex - b.startIndex)
  return boundaries
}

function computeInsertIndex(lines, startIndex, endIndex) {
  let insertIndex = startIndex + 1
  for (let i = startIndex + 1; i < endIndex; i += 1) {
    if (lines[i].startsWith("- ")) {
      insertIndex = i + 1
    }
  }
  return insertIndex
}

function insertEntriesBySection(lines, orderedSections, entriesBySection) {
  const operations = []

  orderedSections.forEach((current) => {
    const entries = entriesBySection.get(current.section)
    if (!entries || entries.length === 0) return

    const insertIndex = computeInsertIndex(
      lines,
      current.startIndex,
      current.endIndex
    )
    operations.push({
      section: current.section,
      insertIndex,
      entries,
    })
  })

  operations.sort((a, b) => b.insertIndex - a.insertIndex)
  operations.forEach((operation) => {
    lines.splice(operation.insertIndex, 0, ...operation.entries)
  })
}

async function ensureContinuityFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, TEMPLATE, "utf8")
        return TEMPLATE
      }
    }
    throw error
  }
}

async function readContinuityFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        throw new Error("docs/CONTINUITY.md not found")
      }
    }
    throw error
  }
}

async function ensureMemoryFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, MEMORY_TEMPLATE, "utf8")
        return MEMORY_TEMPLATE
      }
    }
    throw error
  }
}

function getBulletEntries(lines, encoder, hasTrailingNewline) {
  const entries = []
  let current = null
  lines.forEach((line, index) => {
    const match = line.match(HEADER_PATTERN)
    if (match) {
      current = match[1]
      return
    }
    if (current && line.startsWith("- ")) {
      const needsNewline = hasTrailingNewline || index < lines.length - 1
      const suffix = needsNewline ? "\n" : ""
      const tokens = encoder.encode(`${line}${suffix}`).length
      entries.push({ section: current, line, index, tokens })
    }
  })
  return entries
}

function countTokensForContent(content, encoder) {
  if (content.length === 0) return 0
  return encoder.encode(content).length
}

function computeSectionBudgets(availableTokens) {
  const budgets = new Map()
  const remainders = []
  let allocated = 0

  SECTIONS.forEach((section) => {
    const weight = SECTION_RATIO_WEIGHTS[section]
    const raw = (availableTokens * weight) / SECTION_RATIO_TOTAL
    const floored = Math.floor(raw)
    budgets.set(section, floored)
    allocated += floored
    remainders.push({ section, remainder: raw - floored })
  })

  let remainderTokens = Math.max(0, availableTokens - allocated)
  remainders.sort((a, b) => b.remainder - a.remainder)
  let index = 0
  while (remainderTokens > 0 && remainders.length > 0) {
    const section = remainders[index % remainders.length].section
    budgets.set(section, (budgets.get(section) ?? 0) + 1)
    remainderTokens -= 1
    index += 1
  }

  return budgets
}

function truncateEntriesToTargetThreshold(
  lines,
  entries,
  targetThreshold,
  encoder,
  hasTrailingNewline
) {
  const removedBySection = new Map()
  if (entries.length === 0) {
    return removedBySection
  }

  let tokenCount = countTokensForContent(lines.join("\n"), encoder)
  if (tokenCount <= targetThreshold) {
    return removedBySection
  }

  const bulletTokensTotal = entries.reduce((sum, entry) => sum + entry.tokens, 0)
  const headerTokens = Math.max(0, tokenCount - bulletTokensTotal)
  const availableBulletTokens = Math.max(0, targetThreshold - headerTokens)
  const budgets = computeSectionBudgets(availableBulletTokens)

  const entriesBySection = new Map()
  entries.forEach((entry) => {
    const existing = entriesBySection.get(entry.section) ?? []
    existing.push(entry)
    entriesBySection.set(entry.section, existing)
  })

  const indexesToRemove = []
  entriesBySection.forEach((sectionEntries, section) => {
    const budget = budgets.get(section) ?? 0
    let sectionTokens = sectionEntries.reduce(
      (sum, entry) => sum + entry.tokens,
      0
    )
    let removeCount = 0
    while (sectionTokens > budget && removeCount < sectionEntries.length) {
      const entry = sectionEntries[removeCount]
      indexesToRemove.push(entry.index)
      sectionTokens -= entry.tokens
      removeCount += 1

      const existing = removedBySection.get(section) ?? []
      existing.push(entry.line)
      removedBySection.set(section, existing)
    }
  })

  indexesToRemove.sort((a, b) => b - a)
  indexesToRemove.forEach((index) => {
    lines.splice(index, 1)
  })

  tokenCount = countTokensForContent(lines.join("\n"), encoder)
  while (tokenCount > targetThreshold) {
    const remainingEntries = getBulletEntries(
      lines,
      encoder,
      hasTrailingNewline
    )
    if (remainingEntries.length === 0) {
      break
    }

    const sectionTokens = new Map()
    const sectionEntries = new Map()
    SECTIONS.forEach((section) => {
      sectionTokens.set(section, 0)
      sectionEntries.set(section, [])
    })
    remainingEntries.forEach((entry) => {
      const nextTokens = (sectionTokens.get(entry.section) ?? 0) + entry.tokens
      sectionTokens.set(entry.section, nextTokens)
      sectionEntries.get(entry.section)?.push(entry)
    })

    const bulletTokensTotal = remainingEntries.reduce(
      (sum, entry) => sum + entry.tokens,
      0
    )
    const currentHeaderTokens = Math.max(0, tokenCount - bulletTokensTotal)
    const availableBulletTokens = Math.max(0, targetThreshold - currentHeaderTokens)
    const ratioBudgets = computeSectionBudgets(availableBulletTokens)

    let targetSection = null
    let maxOverage = Number.NEGATIVE_INFINITY
    SECTIONS.forEach((section) => {
      const sectionEntryList = sectionEntries.get(section) ?? []
      if (sectionEntryList.length === 0) return
      const overage =
        (sectionTokens.get(section) ?? 0) - (ratioBudgets.get(section) ?? 0)
      if (overage > maxOverage) {
        maxOverage = overage
        targetSection = section
      }
    })

    if (!targetSection || maxOverage <= 0) {
      let maxTokens = Number.NEGATIVE_INFINITY
      SECTIONS.forEach((section) => {
        const sectionEntryList = sectionEntries.get(section) ?? []
        if (sectionEntryList.length === 0) return
        const tokens = sectionTokens.get(section) ?? 0
        if (tokens > maxTokens) {
          maxTokens = tokens
          targetSection = section
        }
      })
    }

    if (!targetSection) {
      break
    }

    const targetEntries = sectionEntries.get(targetSection) ?? []
    const entry = targetEntries[0]
    if (!entry) {
      break
    }

    lines.splice(entry.index, 1)

    const existing = removedBySection.get(entry.section) ?? []
    existing.push(entry.line)
    removedBySection.set(entry.section, existing)

    tokenCount = countTokensForContent(lines.join("\n"), encoder)
  }

  return removedBySection
}

function collectSectionTail(lines, boundary, linesPerSection) {
  const entries = []
  for (let i = boundary.startIndex + 1; i < boundary.endIndex; i += 1) {
    const line = lines[i]
    if (line.startsWith("- ")) {
      entries.push(line)
    }
  }
  if (linesPerSection >= entries.length) {
    return entries
  }
  return entries.slice(entries.length - linesPerSection)
}

export default tool({
  description:
    "Read or update docs/CONTINUITY.md with validated, timestamped entries",
  args: {
    command: tool.schema.enum(["read", "update"]),
    updates: tool.schema
      .array(
        tool.schema.object({
          section: tool.schema.enum(SECTIONS),
          provenance: tool.schema.enum(PROVENANCE),
          plan: tool.schema
            .string()
            .regex(/^[a-z0-9][a-z0-9.-]*$/)
            .optional(),
          text: tool.schema.string().min(1).max(400),
        })
      )
      .optional(),
    compaction: tool.schema
      .object({
        enabled: tool.schema.boolean().optional(),
        upperTokenThreshold: tool.schema.number().int().positive().optional(),
        lowerTokenThreshold: tool.schema.number().int().positive().optional(),
        totalTokenThreshold: tool.schema.number().int().positive().optional(),
        encoding: tool.schema.string().optional(),
      })
      .optional(),
    read: tool.schema
      .object({
        linesPerSection: tool.schema.number().int().positive().optional(),
      })
      .optional(),
  },
  async execute(args, context) {
    if (!context.worktree) {
      throw new Error("Missing worktree in tool context")
    }

    const continuityPath = path.join(
      context.worktree,
      "docs",
      "CONTINUITY.md"
    )

    if (args.command === "read") {
      if (args.updates && args.updates.length > 0) {
        throw new Error("updates are not supported for read command")
      }
      if (args.compaction) {
        throw new Error("compaction is not supported for read command")
      }
      const { linesPerSection } = resolveReadConfig(args.read)

      const content = await readContinuityFile(continuityPath)
      const lines = content.split(/\r?\n/)
      const orderedSections = getSectionBoundaries(lines)
      const outputLines = []

      orderedSections.forEach((boundary, index) => {
        outputLines.push(`## [${boundary.section}]`)
        const entries = collectSectionTail(lines, boundary, linesPerSection)
        entries.forEach((entry) => outputLines.push(entry))
        if (index < orderedSections.length - 1) {
          outputLines.push("")
        }
      })

      return outputLines.join("\n")
    }

    if (args.read) {
      throw new Error("read options are only supported for read command")
    }
    if (!args.updates || args.updates.length === 0) {
      throw new Error("updates must be provided for update command")
    }

    const timestamp = `${new Date().toISOString().slice(0, 16)}Z`
    const memoryPath = path.join(context.worktree, "docs", "MEMORY.md")
    const compactionConfig = resolveCompactionConfig(args.compaction)

    const updatesBySection = new Map()
    args.updates.forEach((update) => {
      validateText(update.text)
      const entry = buildEntry(timestamp, update)
      const entries = updatesBySection.get(update.section) ?? []
      entries.push(entry)
      updatesBySection.set(update.section, entries)
    })

    const content = await ensureContinuityFile(continuityPath)
    const hasTrailingNewline = content.endsWith("\n")
    const lines = content.split(/\r?\n/)

    const orderedSections = getSectionBoundaries(lines)
    insertEntriesBySection(lines, orderedSections, updatesBySection)

    const compactionEntriesBySection = new Map()
    let removedBySection = new Map()
    let memoryPatchLines = null
    let compactionTriggered = false

    if (compactionConfig.enabled) {
      const encoder = get_encoding(compactionConfig.encoding)
      try {
        const totalTokens = countTokensForContent(lines.join("\n"), encoder)

        if (totalTokens > compactionConfig.upperTokenThreshold) {
          compactionTriggered = true
          const compactionEntry =
            "- " +
            `${timestamp} [TOOL] Compaction triggered: exceeded upper token threshold; truncated oldest entries to at or below lower target; archived to docs/MEMORY.md.`
          compactionEntriesBySection.set("DISCOVERIES", [compactionEntry])
          insertEntriesBySection(
            lines,
            orderedSections,
            compactionEntriesBySection
          )

          const entriesAfter = getBulletEntries(
            lines,
            encoder,
            hasTrailingNewline
          )
          removedBySection =
            truncateEntriesToTargetThreshold(
              lines,
              entriesAfter,
              compactionConfig.lowerTokenThreshold,
              encoder,
              hasTrailingNewline
            ) ?? new Map()

          if (removedBySection.size > 0) {
            const memoryContent = await ensureMemoryFile(memoryPath)
            const memoryHasTrailingNewline = memoryContent.endsWith("\n")
            const memoryLines = memoryContent.split(/\r?\n/)
            const memorySections = getSectionBoundaries(memoryLines)
            insertEntriesBySection(memoryLines, memorySections, removedBySection)

            let memoryOutput = memoryLines.join("\n")
            if (memoryHasTrailingNewline && !memoryOutput.endsWith("\n")) {
              memoryOutput += "\n"
            }
            if (!memoryHasTrailingNewline && memoryOutput.endsWith("\n")) {
              memoryOutput = memoryOutput.replace(/\n$/, "")
            }
            await fs.writeFile(memoryPath, memoryOutput, "utf8")

            const removedCount = Array.from(removedBySection.values()).reduce(
              (sum, entries) => sum + entries.length,
              0
            )
            const removedSections = Array.from(removedBySection.keys()).join(", ")
            const memorySummary = `Archived ${removedCount} entr${
              removedCount === 1 ? "y" : "ies"
            } into docs/MEMORY.md (${removedSections}).`

            memoryPatchLines = [
              "*** Begin Patch",
              "*** Update File: docs/MEMORY.md",
              `*** Summary: ${memorySummary}`,
            ]
            SECTIONS.forEach((section) => {
              const entries = removedBySection.get(section)
              if (!entries || entries.length === 0) return
              memoryPatchLines.push(`@@ ## [${section}]`)
              entries.forEach((entry) => {
                memoryPatchLines.push(`+${entry}`)
              })
            })
            memoryPatchLines.push("*** End Patch")
          }
        }
      } finally {
        encoder.free()
      }
    }

    let output = lines.join("\n")
    if (hasTrailingNewline && !output.endsWith("\n")) {
      output += "\n"
    }
    if (!hasTrailingNewline && output.endsWith("\n")) {
      output = output.replace(/\n$/, "")
    }

    await fs.writeFile(continuityPath, output, "utf8")

    const addedEntriesBySection = new Map()
    updatesBySection.forEach((entries, section) => {
      addedEntriesBySection.set(section, [...entries])
    })
    compactionEntriesBySection.forEach((entries, section) => {
      const existing = addedEntriesBySection.get(section) ?? []
      addedEntriesBySection.set(section, existing.concat(entries))
    })

    const totalAdded = Array.from(addedEntriesBySection.values()).reduce(
      (sum, entries) => sum + entries.length,
      0
    )
    const updatedSections = Array.from(addedEntriesBySection.keys()).join(", ")
    let summary = `Updated ${totalAdded} entr${
      totalAdded === 1 ? "y" : "ies"
    } across ${addedEntriesBySection.size} section${
      addedEntriesBySection.size === 1 ? "" : "s"
    } (${updatedSections}).`
    if (compactionTriggered && removedBySection.size > 0) {
      const removedCount = Array.from(removedBySection.values()).reduce(
        (sum, entries) => sum + entries.length,
        0
      )
      summary += ` Compaction archived ${removedCount} entr${
        removedCount === 1 ? "y" : "ies"
      } into docs/MEMORY.md.`
    }

    const patchLines = [
      "*** Begin Patch",
      "*** Update File: docs/CONTINUITY.md",
      `*** Summary: ${summary}`,
    ]

    SECTIONS.forEach((section) => {
      const entries = addedEntriesBySection.get(section)
      if (!entries || entries.length === 0) return
      patchLines.push(`@@ ## [${section}]`)
      entries.forEach((entry) => {
        patchLines.push(`+${entry}`)
      })
    })

    patchLines.push("*** End Patch")
    if (memoryPatchLines) {
      patchLines.push("")
      patchLines.push(...memoryPatchLines)
    }
    return patchLines.join("\n")
  },
})
