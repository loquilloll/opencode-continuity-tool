import { tool } from "@opencode-ai/plugin"
import fs from "fs/promises"
import path from "path"

const SECTIONS = [
  "PLANS",
  "DECISIONS",
  "PROGRESS",
  "DISCOVERIES",
  "OUTCOMES",
] as const

const PROVENANCE = [
  "USER",
  "CODE",
  "TOOL",
  "ASSUMPTION",
  "UNCONFIRMED",
] as const

type Section = (typeof SECTIONS)[number]
type Provenance = (typeof PROVENANCE)[number]

type ContinuityUpdate = {
  section: Section
  provenance: Provenance
  plan?: string
  text: string
}

const TEMPLATE = `# CONTINUITY

## [PLANS]

## [DECISIONS]

## [PROGRESS]

## [DISCOVERIES]

## [OUTCOMES]
`

const HEADER_PATTERN =
  /^## \[(PLANS|DECISIONS|PROGRESS|DISCOVERIES|OUTCOMES)\]\s*$/

function validateText(text: string) {
  if (text.includes("\n") || text.includes("\r")) {
    throw new Error("text must be a single line")
  }
  if (text.trim().length === 0) {
    throw new Error("text must not be blank")
  }
}

function buildEntry(timestamp: string, update: ContinuityUpdate) {
  const planSegment = update.plan ? ` [plan:${update.plan}]` : ""
  return `- ${timestamp} [${update.provenance}]${planSegment} ${update.text}`
}

function findSectionIndexes(lines: string[]) {
  const indexBySection = new Map<Section, number>()

  lines.forEach((line, index) => {
    const match = line.match(HEADER_PATTERN)
    if (!match) return

    const section = match[1] as Section
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

function computeInsertIndex(
  lines: string[],
  startIndex: number,
  endIndex: number
) {
  let insertIndex = startIndex + 1
  for (let i = startIndex + 1; i < endIndex; i += 1) {
    if (lines[i].startsWith("- ")) {
      insertIndex = i + 1
    }
  }
  return insertIndex
}

async function ensureContinuityFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, TEMPLATE, "utf8")
      return TEMPLATE
    }
    throw error
  }
}

export default tool({
  description: "Update docs/CONTINUITY.md with validated, timestamped entries",
  args: {
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
      .min(1),
  },
  async execute(args, context) {
    if (!context.worktree) {
      throw new Error("Missing worktree in tool context")
    }

    const timestamp = `${new Date().toISOString().slice(0, 16)}Z`
    const continuityPath = path.join(
      context.worktree,
      "docs",
      "CONTINUITY.md"
    )

    const updatesBySection = new Map<Section, string[]>()
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

    const sectionIndexes = findSectionIndexes(lines)
    const orderedSections = SECTIONS.map((section) => ({
      section,
      index: sectionIndexes.get(section) ?? 0,
    })).sort((a, b) => a.index - b.index)

    const operations: Array<{
      section: Section
      insertIndex: number
      entries: string[]
    }> = []

    orderedSections.forEach((current, index) => {
      const entries = updatesBySection.get(current.section)
      if (!entries || entries.length === 0) return

      const endIndex =
        index + 1 < orderedSections.length
          ? orderedSections[index + 1].index
          : lines.length
      const insertIndex = computeInsertIndex(lines, current.index, endIndex)
      operations.push({ section: current.section, insertIndex, entries })
    })

    operations.sort((a, b) => b.insertIndex - a.insertIndex)
    operations.forEach((operation) => {
      lines.splice(operation.insertIndex, 0, ...operation.entries)
    })

    let output = lines.join("\n")
    if (hasTrailingNewline && !output.endsWith("\n")) {
      output += "\n"
    }
    if (!hasTrailingNewline && output.endsWith("\n")) {
      output = output.replace(/\n$/, "")
    }

    await fs.writeFile(continuityPath, output, "utf8")

    const updatedSections = Array.from(updatesBySection.keys()).join(", ")
    return `Updated ${args.updates.length} entr${
      args.updates.length === 1 ? "y" : "ies"
    } across ${updatesBySection.size} section${
      updatesBySection.size === 1 ? "" : "s"
    } (${updatedSections}).`
  },
})
