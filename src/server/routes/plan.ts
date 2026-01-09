import { generateObject } from "ai"
import { Elysia, t } from "elysia"
import { logElysia } from "../../logger"
import { documentationPlanSchema } from "../../types"
import type { AppContext } from "../context"

/**
 * plan route for structured plan generation
 */
export function createPlanRoute(ctx: AppContext) {
  logElysia("info", "plan route initialized", { route: "/api/plan" })

  return new Elysia().post(
    "/api/plan",
    async ({ body }) => {
      const { analysisResult, task } = body

      logElysia("info", "plan request", { taskLength: task.length })

      const prompt = `Based on the following analysis, create a documentation plan.

TASK: ${task}

ANALYSIS RESULT:
${JSON.stringify(analysisResult, null, 2)}

CRITICAL PRINCIPLES:
1. REORGANIZE over ADD: If docs are messy, reorganize first
2. UPDATE over CREATE: If a doc exists but is incomplete, update it
3. CONSOLIDATE over DUPLICATE: If multiple docs cover similar topics, consolidate
4. DELETE ruthlessly: Remove outdated sections

Create a SMART plan with specific, measurable, achievable operations.
Order operations by priority (1 = highest).
Include dependencies between operations when one must complete before another.`

      try {
        const result = await generateObject({
          model: ctx.runtimeConfig.models.planning,
          prompt,
          schema: documentationPlanSchema,
        })

        logElysia("info", "plan generated", {
          operationsCount: result.object.operations.length,
        })

        return result.object
      } catch (error) {
        logElysia("error", "plan generation failed", {
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown error",
        })
        throw error
      }
    },
    {
      body: t.Object({
        analysisResult: t.Any(),
        task: t.String(),
      }),
    },
  )
}
