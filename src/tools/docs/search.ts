import { z } from "zod"
import type { DocIndex } from "../../index/doc-index"
import { logTool, logToolResult } from "../../logger"

const inputSchema = z.object({
  limit: z.number().default(5).describe("max results to return"),
  query: z.string().describe("the search query"),
  type: z
    .enum(["semantic", "exact", "hybrid"])
    .default("hybrid")
    .describe(
      "search type: semantic for concepts, exact for terms, hybrid for best results",
    ),
})

export const createSearchDocsTool = (docIndex: DocIndex) => ({
  description:
    "search documentation using semantic search (for concepts) or text search (for exact terms)",
  execute: async ({ query, type, limit }: z.infer<typeof inputSchema>) => {
    logTool("search_docs", { limit, query, type })
    const start = performance.now()

    const results =
      type === "exact"
        ? await docIndex.exactSearch(query, limit)
        : type === "semantic"
          ? await docIndex.semanticSearch(query, limit)
          : await docIndex.hybridSearch(query, limit)

    logToolResult({ count: results.length }, performance.now() - start)
    return results
  },
  inputSchema,
})
