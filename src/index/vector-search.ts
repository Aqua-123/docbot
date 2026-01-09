import type { QdrantClient } from "@qdrant/qdrant-js"
import { embedText } from "../db/embed"
import { searchDocs } from "../db/qdrant"
import { logInfo, timed } from "../logger"
import type { SearchResult } from "../types"

/**
 * perform semantic search using qdrant vector database
 *
 * @param client - Qdrant client instance
 * @param query - Search query string
 * @param embeddingModelId - The model ID for embeddings
 * @param limit - Maximum number of results
 * @param filter - Optional filter by path
 * @param collectionName - Name of the docs collection
 */
export async function vectorSearch(
  client: QdrantClient,
  query: string,
  embeddingModelId: string,
  limit: number,
  filter: { path?: string } | undefined,
  collectionName: string,
): Promise<SearchResult[]> {
  // embed the query
  const queryVector = await timed(
    "embed",
    `embedding query "${query.slice(0, 50)}..."`,
    () => embedText(query, embeddingModelId),
  )

  // search qdrant
  const results = await timed("qdrant", `searching ${limit} docs`, () =>
    searchDocs(client, queryVector, limit, filter, collectionName),
  )

  logInfo(`vector search found ${results.length} results`)
  return results
}

/**
 * find similar documents to a given document
 *
 * @param client - Qdrant client instance
 * @param content - Content to find similar documents for
 * @param embeddingModelId - The model ID for embeddings
 * @param limit - Maximum number of results
 * @param excludePath - Optional path to exclude from results
 * @param collectionName - Name of the docs collection
 */
export async function findSimilar(
  client: QdrantClient,
  content: string,
  embeddingModelId: string,
  limit: number,
  excludePath: string | undefined,
  collectionName: string,
): Promise<SearchResult[]> {
  const queryVector = await timed(
    "embed",
    `embedding content (${content.length} chars)`,
    () => embedText(content, embeddingModelId),
  )

  const results = await timed("qdrant", `finding ${limit} similar docs`, () =>
    searchDocs(client, queryVector, limit + 1, undefined, collectionName),
  )

  // filter out the source document if specified
  if (excludePath) {
    return results.filter((r) => r.path !== excludePath).slice(0, limit)
  }

  return results.slice(0, limit)
}
