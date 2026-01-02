import { z } from "zod"
import type { Phase } from "../../types"

const inputSchema = z.object({
  hasEnoughInfo: z
    .boolean()
    .optional()
    .describe("for analysis phase: do you have enough info to proceed?"),
  needsUserHelp: z
    .boolean()
    .optional()
    .describe("set true if you need user guidance to continue"),
  phase: z
    .enum(["analysis", "planning", "execution", "review"])
    .describe("the workflow phase to transition to"),
  summary: z
    .string()
    .describe("brief summary of what was accomplished in this phase"),
})

/**
 * tool for updating workflow phase status
 *
 * call this to explicitly transition between workflow phases:
 * - analysis: searching docs and codebase
 * - planning: proposing documentation changes
 * - execution: writing/updating documentation files
 * - review: summarizing changes and remaining work
 */
export const createUpdateStatusTool = () => ({
  description:
    "update your current workflow phase. call this to transition between phases. " +
    "phases: analysis (discovery), planning (propose changes), execution (write docs), review (summarize).",
  execute: ({
    phase,
    summary,
    hasEnoughInfo,
    needsUserHelp,
  }: z.infer<typeof inputSchema>) => {
    return {
      hasEnoughInfo: hasEnoughInfo ?? null,
      needsUserHelp: needsUserHelp ?? false,
      phase: phase as Phase,
      summary,
      transitioned: true,
    }
  },
  inputSchema,
})
