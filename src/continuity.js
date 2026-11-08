import { tool } from "@opencode-ai/plugin"
import { SECTIONS, PROVENANCE, executeLegacy } from "./core.js"
import path from "node:path"
import os from "node:os"

export * from "./core.js"

export default tool({
  description:
    "Branch-isolated continuity shared by primary agents and subagents. Read shared knowledge plus this branch's progress; update deliberate findings. Read defaults to delta and requires sessionId unless mode=tail. status reports pending work. distill requires plugin installation.",
  args: {
    command: tool.schema.enum(["read", "update", "status", "distill"]),
    branch: tool.schema.string().optional(),
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
      .max(100)
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
        mode: tool.schema
          .enum(["tail", "delta"])
          .optional()
          .describe(
            'READ DEFAULT: mode="delta". You MUST provide sessionId unless you explicitly set mode="tail". "delta" returns only new/changed memories since the last read; "tail" returns the latest linesPerSection entries per section and is the only mode that may omit sessionId.'
          ),
        sessionId: tool.schema
          .string()
          .optional()
          .describe(
            'Required for normal read usage because read defaults to mode="delta". Omit sessionId only when you explicitly set mode="tail".'
          ),
        includePinned: tool.schema.boolean().optional(),
        includeUnresolved: tool.schema.boolean().optional(),
        memoryId: tool.schema.string().min(1).optional(),
      })
      .optional(),
  },
  async execute(args, context) {
    if (typeof context?.worktree !== "string") throw new Error("Continuity requires an attributed workspace")
    const { resolveScope } = await import("./storage.js")
    const scope = await resolveScope({ workspace: context.worktree })
    // Keep the historical non-Git custom-tool contract; plugins always use the transactional runtime.
    if (!scope.isGit && ["read", "update"].includes(args.command) && !args.branch && !args.read?.memoryId) return executeLegacy(args, context)
    if (!scope.isGit) throw new Error("Non-Git standalone continuity supports legacy read/update only. Targeted reads, status and distillation require the plugin's transactional store; use a normal read for legacy journal IDs.")
    const { executeContinuity } = await import("./runtime.js")
    const globalConfigRoot = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
    return executeContinuity(args, context, { globalConfigRoot })
  },
})
