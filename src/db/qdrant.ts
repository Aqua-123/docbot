import { createHash } from "node:crypto"
import { QdrantClient } from "@qdrant/qdrant-js"
import { config } from "../config"
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
 * get collection config by type (fallback to global config)
 */
function getCollectionConfig(type: CollectionType) {
  return config.qdrant.collections[type]
}

/**
 * initialize qdrant client and ensure collections exist
 */
export async function initQdrant(
  url = config.qdrant.url,
  collections?: { docs: string; code: string },
): Promise<QdrantClient> {
  const client = new QdrantClient({ url })

  // use provided collection names or fall back to global config
  const docsCollection = collections?.docs ?? getCollectionConfig("docs").name
  const codeCollection = collections?.code ?? getCollectionConfig("code").name

  // ensure both collections exist
  await ensureCollectionByName(client, docsCollection, "docs")
  await ensureCollectionByName(client, codeCollection, "code")

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
 */
export async function upsertDocChunks(
  client: QdrantClient,
  chunks: DocChunk[],
  collectionName?: string,
): Promise<void> {
  if (chunks.length === 0) return

  const name = collectionName ?? getCollectionConfig("docs").name

  await client.upsert(name, {
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
 */
export async function upsertCodeChunks(
  client: QdrantClient,
  chunks: CodeChunk[],
  collectionName?: string,
): Promise<void> {
  if (chunks.length === 0) return

  const name = collectionName ?? getCollectionConfig("code").name

  await client.upsert(name, {
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
 */
export async function searchDocs(
  client: QdrantClient,
  queryVector: number[],
  limit = 5,
  filter?: { path?: string },
  collectionName?: string,
): Promise<SearchResult[]> {
  const name = collectionName ?? getCollectionConfig("docs").name

  const results = await client.search(name, {
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
 */
export async function searchCode(
  client: QdrantClient,
  queryVector: number[],
  limit = 5,
  filter?: { path?: string; language?: string },
  collectionName?: string,
): Promise<SearchResult[]> {
  const name = collectionName ?? getCollectionConfig("code").name

  const must: Array<{ key: string; match: { value: string } }> = []
  if (filter?.path) {
    must.push({ key: "path", match: { value: filter.path } })
  }
  if (filter?.language) {
    must.push({ key: "language", match: { value: filter.language } })
  }

  const results = await client.search(name, {
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
 */
export async function deleteDocChunks(
  client: QdrantClient,
  path: string,
  collectionName?: string,
): Promise<void> {
  const name = collectionName ?? getCollectionConfig("docs").name

  await client.delete(name, {
    filter: {
      must: [{ key: "path", match: { value: path } }],
    },
    wait: true,
  })
}

/**
 * delete all chunks for a specific code file path
 */
export async function deleteCodeChunks(
  client: QdrantClient,
  path: string,
  collectionName?: string,
): Promise<void> {
  const name = collectionName ?? getCollectionConfig("code").name

  await client.delete(name, {
    filter: {
      must: [{ key: "path", match: { value: path } }],
    },
    wait: true,
  })
}
