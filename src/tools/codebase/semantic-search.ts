import { z } from "zod"
import type { CodeIndex } from "../../index/code-index"
import { logTool, logToolResult } from "../../logger"

const inputSchema = z.object({
  language: z
    .string()
    .optional()
    .describe("optional language filter (e.g. 'typescript', 'python')."),
  limit: z.number().default(5).describe("max results to return"),
  query: z
    .string()
    .describe(
      "natural language query about code (e.g. 'where do we handle authentication', 'error handling middleware'). for exact identifiers, use code_search.",
    ),
  type: z
    .enum(["semantic", "hybrid"])
    .default("hybrid")
    .describe("search mode: semantic (vector) or hybrid (vector + rerank)."),
})

export const createSemanticCodeSearchTool = (codeIndex: CodeIndex) => ({
  description:
    "semantic search over the codebase (conceptual queries). use code_search for exact identifiers or regex.",
  execute: async ({
    query,
    type,
    limit,
    language,
  }: z.infer<typeof inputSchema>) => {
    logTool("semantic_code_search", { language, limit, query, type })
    const start = performance.now()

    const results =
      type === "semantic"
        ? await codeIndex.semanticSearch(query, limit, { language })
        : await codeIndex.hybridSearch(query, limit)

    logToolResult({ count: results.length }, performance.now() - start)
    return results
  },
  inputSchema,
})
