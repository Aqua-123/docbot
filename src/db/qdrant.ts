import { createHash } from "node:crypto"
import { QdrantClient } from "@qdrant/qdrant-js"
import type { CodeChunk, DocChunk, SearchResult } from "../types"

export type CollectionType = "docs" | "code"

// default vector size for embeddings
const DEFAULT_VECTOR_SIZE = 1536

/**
 * convert string id to valid uuid v5 format for qdrant
 */
function stringToUuid(str: string): string {
  const hash = createHash("sha1").update(str).digest("hex")
  // format as uuid v5: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-5${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`
}

/**
 * initialize qdrant client and ensure collections exist
 *
 * @param url - Qdrant server URL
 * @param collections - Collection names for docs and code
 */
export async function initQdrant(
  url: string,
  collections: { docs: string; code: string },
): Promise<QdrantClient> {
  const client = new QdrantClient({ url })

  // ensure both collections exist
  await ensureCollectionByName(client, collections.docs, "docs")
  await ensureCollectionByName(client, collections.code, "code")

  return client
}

/**
 * ensure a specific collection exists with proper schema
 */
async function ensureCollectionByName(
  client: QdrantClient,
  name: string,
  type: CollectionType,
): Promise<void> {
  const collections = await client.getCollections()
  const exists = collections.collections.some((c) => c.name === name)

  if (!exists) {
    await client.createCollection(name, {
      vectors: { distance: "Cosine", size: DEFAULT_VECTOR_SIZE },
    })

    // payload indexes for filtering
    await client.createPayloadIndex(name, {
      field_name: "path",
      field_schema: "keyword",
      wait: true,
    })

    // section index for docs, symbol index for code
    const secondaryIndex = type === "docs" ? "section" : "symbol"
    await client.createPayloadIndex(name, {
      field_name: secondaryIndex,
      field_schema: "keyword",
      wait: true,
    })

    // code collection gets additional indexes
    if (type === "code") {
      await client.createPayloadIndex(name, {
        field_name: "language",
        field_schema: "keyword",
        wait: true,
      })
    }
  }
}

/**
 * upsert document chunks into a docs collection
 *
 * @param client - Qdrant client instance
 * @param chunks - Document chunks to upsert
 * @param collectionName - Name of the docs collection
 */
export async function upsertDocChunks(
  client: QdrantClient,
  chunks: DocChunk[],
  collectionName: string,
): Promise<void> {
  if (chunks.length === 0) return

  await client.upsert(collectionName, {
    points: chunks.map((c) => ({
      id: stringToUuid(c.id),
      payload: {
        content: c.content,
        originalId: c.id,
        path: c.path,
        section: c.section,
      },
      vector: c.vector,
    })),
    wait: true,
  })
}

/**
 * upsert code chunks into a code collection
 *
 * @param client - Qdrant client instance
 * @param chunks - Code chunks to upsert
 * @param collectionName - Name of the code collection
 */
export async function upsertCodeChunks(
  client: QdrantClient,
  chunks: CodeChunk[],
  collectionName: string,
): Promise<void> {
  if (chunks.length === 0) return

  await client.upsert(collectionName, {
    points: chunks.map((c) => ({
      id: stringToUuid(c.id),
      payload: {
        content: c.content,
        endLine: c.endLine,
        language: c.language,
        originalId: c.id,
        path: c.path,
        startLine: c.startLine,
        symbol: c.symbol,
        symbolType: c.symbolType,
      },
      vector: c.vector,
    })),
    wait: true,
  })
}

/**
 * search documents by vector similarity
 *
 * @param client - Qdrant client instance
 * @param queryVector - Query embedding vector
 * @param limit - Maximum number of results
 * @param filter - Optional filter by path
 * @param collectionName - Name of the docs collection
 */
export async function searchDocs(
  client: QdrantClient,
  queryVector: number[],
  limit: number,
  filter: { path?: string } | undefined,
  collectionName: string,
): Promise<SearchResult[]> {
  const results = await client.search(collectionName, {
    filter: filter?.path
      ? { must: [{ key: "path", match: { value: filter.path } }] }
      : undefined,
    limit,
    vector: queryVector,
    with_payload: true,
  })

  return results.map((r) => ({
    content: String(r.payload?.content ?? ""),
    id: String(r.payload?.originalId ?? r.id),
    path: String(r.payload?.path ?? ""),
    score: r.score,
    section: String(r.payload?.section ?? ""),
  }))
}

/**
 * search code by vector similarity
 *
 * @param client - Qdrant client instance
 * @param queryVector - Query embedding vector
 * @param limit - Maximum number of results
 * @param filter - Optional filter by path and/or language
 * @param collectionName - Name of the code collection
 */
export async function searchCode(
  client: QdrantClient,
  queryVector: number[],
  limit: number,
  filter: { path?: string; language?: string } | undefined,
  collectionName: string,
): Promise<SearchResult[]> {

  const must: Array<{ key: string; match: { value: string } }> = []
  if (filter?.path) {
    must.push({ key: "path", match: { value: filter.path } })
  }
  if (filter?.language) {
    must.push({ key: "language", match: { value: filter.language } })
  }

  const results = await client.search(collectionName, {
    filter: must.length > 0 ? { must } : undefined,
    limit,
    vector: queryVector,
    with_payload: true,
  })

  return results.map((r) => ({
    content: String(r.payload?.content ?? ""),
    id: String(r.payload?.originalId ?? r.id),
    path: String(r.payload?.path ?? ""),
    score: r.score,
    section: String(r.payload?.symbol ?? ""),
  }))
}

/**
 * delete all chunks for a specific document path
 *
 * @param client - Qdrant client instance
 * @param path - Document path to delete chunks for
 * @param collectionName - Name of the docs collection
 */
export async function deleteDocChunks(
  client: QdrantClient,
  path: string,
  collectionName: string,
): Promise<void> {
  await client.delete(collectionName, {
    filter: {
      must: [{ key: "path", match: { value: path } }],
    },
    wait: true,
  })
}

/**
 * delete all chunks for a specific code file path
 *
 * @param client - Qdrant client instance
 * @param path - Code file path to delete chunks for
 * @param collectionName - Name of the code collection
 */
export async function deleteCodeChunks(
  client: QdrantClient,
  path: string,
  collectionName: string,
): Promise<void> {
  await client.delete(collectionName, {
    filter: {
      must: [{ key: "path", match: { value: path } }],
    },
    wait: true,
  })
}
