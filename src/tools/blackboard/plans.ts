import { z } from "zod"
import type { Blackboard } from "../../blackboard"
import type { PlanOutline } from "../../blackboard/types"

export function createBlackboardPlansTools(blackboard: Blackboard) {
  return {
    blackboard_read_plan: {
      description: "read a specific plan by id from the blackboard",
      execute: ({ planId }: { planId: string }) => {
        const plan = blackboard.getPlan(planId)
        if (!plan) {
          return { error: "plan not found" }
        }
        return {
          approved: plan.approved,
          docTargetId: plan.docTargetId,
          id: plan.id,
          outline: plan.outline,
          title: plan.title,
        }
      },
      inputSchema: z.object({
        planId: z.string(),
      }),
    },
    blackboard_write_plan: {
      description:
        "write a documentation plan to the blackboard. includes outline with sections and finding references.",
      execute: ({
        docTargetId,
        title,
        outline,
      }: {
        docTargetId: string
        title: string
        outline: PlanOutline
      }) => {
        const planId = blackboard.addPlan({
          approved: false,
          docTargetId,
          outline,
          title,
        })
        return {
          planId,
          sectionCount: outline.sections.length,
          title,
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
        outline: z.object({
          sections: z.array(
            z.object({
              description: z.string().optional(),
              findingIds: z.array(z.string()),
              id: z.string(),
              orderIndex: z.number(),
              title: z.string(),
            }),
          ),
        }),
        title: z.string(),
      }),
    },
  }
}
