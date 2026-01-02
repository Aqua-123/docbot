import { $ } from "bun"
import { z } from "zod"
import { logCmd, logError, logTool, logToolResult } from "../../logger"

const FLAG_NAME_PATTERN = /['"]([A-Z_]+_FLAG|[a-z-]+_flag)['"]/i

const inputSchema = z.object({
  featureName: z.string().describe("name of the feature to check"),
})

export const createFeatureStatusTool = (codebasePaths: string[]) => ({
  description: `check the status of a feature in the codebase.

parameters:
- featureName (required): name of the feature to check

returns whether the feature is implemented, feature-flagged, has test coverage, and references to the feature in code.`,
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: preserves existing diagnostic flow
  execute: async ({ featureName }: z.infer<typeof inputSchema>) => {
    logTool("feature_status", { featureName })
    const start = performance.now()

    const status = {
      featureFlagged: false,
      flagName: null as string | null,
      implemented: false,
      references: [] as Array<{ path: string; context: string }>,
      testCoverage: false,
    }

    for (const codebasePath of codebasePaths) {
      // search for the feature in code
      try {
        const args = [
          "--json",
          "--max-count",
          "20",
          "--smart-case",
          featureName,
          codebasePath,
        ]
        logCmd(`rg ${args.join(" ")}`)

        const searchResult = await $`rg ${args}`.quiet()
        const lines = searchResult.stdout
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean)

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type !== "match") continue

            const path = parsed.data?.path?.text ?? ""
            const content = (parsed.data?.lines?.text ?? "").trim()

            status.references.push({ context: content.slice(0, 200), path })

            // check if it's in a test file
            if (
              path.includes(".test.") ||
              path.includes(".spec.") ||
              path.includes("__tests__")
            ) {
              status.testCoverage = true
            }
          } catch {
            // skip malformed json
          }
        }
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("exit code"))) {
          logError(`ripgrep failed for ${codebasePath}`, error)
        }
      }

      // check for feature flags
      try {
        const flagPattern = `feature.*flag|flag.*${featureName}|${featureName}.*enabled`
        const flagArgs = [
          "--json",
          "--max-count",
          "5",
          flagPattern,
          codebasePath,
        ]
        logCmd(`rg ${flagArgs.join(" ")}`)

        const flagResult = await $`rg ${flagArgs}`.quiet()
        const lines = flagResult.stdout
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean)

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type !== "match") continue

            status.featureFlagged = true
            const content = parsed.data?.lines?.text ?? ""

            // try to extract flag name
            const flagMatch = content.match(FLAG_NAME_PATTERN)
            if (flagMatch) {
              status.flagName = flagMatch[1] ?? null
            }
          } catch {
            // skip malformed json
          }
        }
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("exit code"))) {
          logError(`ripgrep flag search failed for ${codebasePath}`, error)
        }
      }
    }

    status.implemented = status.references.length > 0

    const result = {
      featureName,
      ...status,
      summary: status.implemented
        ? status.featureFlagged
          ? `"${featureName}" is implemented but feature-flagged${status.flagName ? ` (${status.flagName})` : ""}`
          : `"${featureName}" is implemented${status.testCoverage ? " with tests" : ""}`
        : `"${featureName}" does not appear to be implemented`,
    }

    logToolResult(result, performance.now() - start)
    return result
  },
  inputSchema,
})
