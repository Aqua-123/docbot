import { cosineSimilarity } from "ai"
import { logRerank } from "../logger"
import type { SearchResult } from "../types"
import { embedText } from "./embed"

/**
 * rerank search results using embedding similarity
 *
 * note: since the cohere reranker api isn't directly available,
 * we use embedding-based reranking instead
 *
 * @param query - The search query
 * @param results - Search results to rerank
 * @param embeddingModelId - The model ID for embeddings
 * @param topN - Number of top results to return
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  embeddingModelId: string,
  topN = 5,
): Promise<SearchResult[]> {
  if (results.length === 0) return []
  if (results.length <= topN) return results

  const start = performance.now()

  // embed the query
  const queryEmbedding = await embedText(query, embeddingModelId)

  // score each result by similarity to query
  const scored = await Promise.all(
    results.map(async (r) => {
      const contentEmbedding = await embedText(r.content, embeddingModelId)
      const similarity = cosineSimilarity(queryEmbedding, contentEmbedding)
      return { ...r, score: similarity }
    }),
  )

  // sort by score and return top N
  const reranked = scored.sort((a, b) => b.score - a.score).slice(0, topN)

  logRerank(
    `${results.length} results → top ${reranked.length}`,
    performance.now() - start,
  )
  return reranked
}
