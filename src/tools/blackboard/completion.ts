import { z } from "zod"
import type { Blackboard } from "../../blackboard"

export function createBlackboardCompletionTools(blackboard: Blackboard) {
  return {
    mark_interaction_complete: {
      description:
        "mark user interaction as complete. call this after presenting info to user or getting their response.",
      execute: ({
        response,
        approved,
      }: {
        response?: string
        approved?: boolean
      }) => {
        return {
          approved,
          completed: true,
          message: "user interaction complete",
          response,
        }
      },
      inputSchema: z.object({
        approved: z
          .boolean()
          .optional()
          .describe("whether the user approved (if applicable)"),
        response: z
          .string()
          .optional()
          .describe("the user response or confirmation"),
      }),
    },
    mark_research_complete: {
      description:
        "mark research phase as complete. call this when you've finished researching and recorded all findings.",
      execute: ({ docTargetId }: { docTargetId: string; summary?: string }) => {
        blackboard.updateDocTargetStatus(docTargetId, "planning")
        return {
          completed: true,
          docTargetId,
          message: "research phase marked complete",
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
        summary: z.string().optional(),
      }),
    },

    mark_writing_complete: {
      description:
        "mark writing phase as complete. call this when you've finished writing all sections for a plan.",
      execute: ({ planId }: { planId: string; summary?: string }) => {
        const plan = blackboard.getPlan(planId)
        if (!plan) {
          return { error: "plan not found" }
        }
        blackboard.updateDocTargetStatus(plan.docTargetId, "complete")
        return {
          completed: true,
          message: "writing phase marked complete",
          planId,
        }
      },
      inputSchema: z.object({
        planId: z.string(),
        summary: z.string().optional(),
      }),
    },

    submit_plan: {
      description:
        "submit a plan for approval. call this when you've created a documentation plan and it's ready for review.",
      execute: ({ planId }: { planId: string; summary?: string }) => {
        const plan = blackboard.getPlan(planId)
        if (!plan) {
          return { error: "plan not found" }
        }
        blackboard.updateDocTargetStatus(plan.docTargetId, "writing")
        return {
          message: "plan submitted for approval",
          planId,
          submitted: true,
        }
      },
      inputSchema: z.object({
        planId: z.string(),
        summary: z.string().optional(),
      }),
    },
  }
}
