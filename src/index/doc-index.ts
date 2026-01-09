import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import type { QdrantClient } from "@qdrant/qdrant-js"
import { embedTexts } from "../db/embed"
import {
  diffManifest,
  type EmbeddingManifest,
  hashContent,
  type ManifestDiff,
  removeManifestEntry,
  saveManifest,
  updateManifestEntry,
} from "../db/manifest"
import { deleteDocChunks, upsertDocChunks } from "../db/qdrant"
import { rerankResults } from "../db/rerank"
import { logInfo, timed } from "../logger"
import { parseMdx } from "../mdx/parser"
import type { DocChunk, MdxDocument, SearchResult } from "../types"
import { textSearch } from "./text-search"
import { findSimilar, vectorSearch } from "./vector-search"

const PARAGRAPH_SPLIT_REGEX = /\n\n+/

/**
 * document index combining vector and text search
 */
export class DocIndex {
  constructor(
    private client: QdrantClient,
    private docsPath: string,
    private collectionName: string,
    private embeddingModelId: string,
  ) {}

  /**
   * scan all doc files and compute hashes for diffing
   */
  async scanFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    const mdxFiles = await this.findMdxFiles()

    for (const filePath of mdxFiles) {
      const relativePath = relative(this.docsPath, filePath)
      const content = await Bun.file(filePath).text()
      const hash = hashContent(content)
      files.set(relativePath, hash)
    }

    return files
  }

  /**
   * sync doc embeddings based on manifest diff
   */
  async syncFromDiff(
    diff: ManifestDiff,
    fileHashes: Map<string, string>,
    manifest: EmbeddingManifest,
    manifestPath?: string,
  ): Promise<{
    added: number
    updated: number
    removed: number
    chunks: number
  }> {
    const syncStart = performance.now()
    let totalChunks = 0
    const totalFiles =
      diff.added.length + diff.changed.length + diff.removed.length
    let processedFiles = 0

    // remove deleted files
    if (diff.removed.length > 0) {
      console.info(`  removing ${diff.removed.length} deleted files...`)
      for (const path of diff.removed) {
        await deleteDocChunks(this.client, path, this.collectionName)
        removeManifestEntry(manifest, "docs", path)
        processedFiles++
        process.stdout.write(
          `\x1b[2K\r    [${processedFiles}/${totalFiles}] removed ${path}`,
        )
      }
      process.stdout.write(`${" ".repeat(80)}\r`)
    }

    // process changed files (delete old, re-embed)
    if (diff.changed.length > 0) {
      console.info(`  updating ${diff.changed.length} changed files...`)
      for (const path of diff.changed) {
        const fileStart = performance.now()
        await deleteDocChunks(this.client, path, this.collectionName)
        const chunks = await this.embedFile(path)
        totalChunks += chunks
        updateManifestEntry(
          manifest,
          "docs",
          path,
          fileHashes.get(path)!,
          chunks,
        )
        processedFiles++
        const fileDuration = ((performance.now() - fileStart) / 1000).toFixed(1)
        process.stdout.write(
          `\x1b[2K\r    [${processedFiles}/${totalFiles}] updated ${path} (${chunks} chunks, ${fileDuration}s)`,
        )
      }
      process.stdout.write("\x1b[2K\r")
    }

    // process new files
    if (diff.added.length > 0) {
      console.info(`  adding ${diff.added.length} new files...`)
      for (let i = 0; i < diff.added.length; i++) {
        const path = diff.added[i]!
        const fileStart = performance.now()
        const chunks = await this.embedFile(path)
        totalChunks += chunks
        updateManifestEntry(
          manifest,
          "docs",
          path,
          fileHashes.get(path)!,
          chunks,
        )
        processedFiles++
        const fileDuration = ((performance.now() - fileStart) / 1000).toFixed(1)
        process.stdout.write(
          `\x1b[2K\r    [${processedFiles}/${totalFiles}] added ${path} (${chunks} chunks, ${fileDuration}s)`,
        )
        // save manifest incrementally (every 50 files or at the end)
        if (manifestPath && (i % 50 === 0 || i === diff.added.length - 1)) {
          await saveManifest(manifestPath, manifest).catch(() => {
            // ignore save errors during processing
          })
        }
      }
      process.stdout.write("\x1b[2K\r")
    }

    const syncDuration = ((performance.now() - syncStart) / 1000).toFixed(1)
    if (totalFiles > 0) {
      console.info(`  sync complete: ${totalChunks} chunks in ${syncDuration}s`)
    }

    return {
      added: diff.added.length,
      chunks: totalChunks,
      removed: diff.removed.length,
      updated: diff.changed.length,
    }
  }

  /**
   * index all mdx documents in the docs directory (legacy, full re-index)
   */
  async indexAll(): Promise<{ indexed: number; chunks: number }> {
    const files = await this.findMdxFiles()

    console.info(`  found ${files.length} mdx files`)
    logInfo(`found ${files.length} mdx files to index`)

    let totalChunks = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      const relativePath = relative(this.docsPath, file)
      process.stdout.write(
        `  [${i + 1}/${files.length}] indexing ${relativePath}...\r`,
      )
      const chunks = await this.indexFile(file)
      totalChunks += chunks
    }

    process.stdout.write(`${" ".repeat(80)}\r`)

    return { chunks: totalChunks, indexed: files.length }
  }

  /**
   * embed a doc file by relative path
   */
  private embedFile(relativePath: string): Promise<number> {
    const fullPath = join(this.docsPath, relativePath)
    return this.indexFile(fullPath)
  }

  /**
   * index a single mdx file (full path)
   */
  async indexFile(filePath: string): Promise<number> {
    const content = await Bun.file(filePath).text()
    const relativePath = relative(this.docsPath, filePath)
    const doc = parseMdx(relativePath, content)

    // delete existing chunks for this file
    await deleteDocChunks(this.client, relativePath, this.collectionName)

    // create chunks from sections
    const chunks = this.createChunks(doc)
    if (chunks.length === 0) return 0

    // embed all chunks
    const texts = chunks.map((c) => c.content)
    const embeddings = await timed(
      "embed",
      `embedding ${chunks.length} chunks from ${relativePath}`,
      () => embedTexts(texts, this.embeddingModelId),
    )

    // add vectors to chunks
    const chunksWithVectors: DocChunk[] = chunks.map((chunk, i) => ({
      ...chunk,
      vector: embeddings[i]!,
    }))

    // upsert to qdrant
    await timed("qdrant", `upserting ${chunks.length} chunks`, () =>
      upsertDocChunks(this.client, chunksWithVectors, this.collectionName),
    )

    return chunks.length
  }

  /**
   * semantic search using vector similarity
   */
  semanticSearch(
    query: string,
    limit = 5,
    filter?: { path?: string },
  ): Promise<SearchResult[]> {
    logInfo(`semantic search: "${query.slice(0, 50)}..."`)
    return vectorSearch(
      this.client,
      query,
      this.embeddingModelId,
      limit,
      filter,
      this.collectionName,
    )
  }

  /**
   * text search using ripgrep
   */
  exactSearch(query: string, limit = 10): Promise<SearchResult[]> {
    logInfo(`text search: "${query}"`)
    return textSearch(query, this.docsPath, limit)
  }

  /**
   * hybrid search: vector search + reranking
   */
  async hybridSearch(query: string, limit = 5): Promise<SearchResult[]> {
    logInfo(`hybrid search: "${query.slice(0, 50)}..."`)

    // get more results from vector search
    const vectorResults = await this.semanticSearch(query, limit * 2)

    // rerank with embedding similarity
    return rerankResults(query, vectorResults, this.embeddingModelId, limit)
  }

  /**
   * find documents similar to a given document
   */
  findSimilarDocs(
    content: string,
    limit = 5,
    excludePath?: string,
  ): Promise<SearchResult[]> {
    return findSimilar(
      this.client,
      content,
      this.embeddingModelId,
      limit,
      excludePath,
      this.collectionName,
    )
  }

  /**
   * rerank search results
   */
  rerank(
    query: string,
    results: SearchResult[],
    limit = 5,
  ): Promise<SearchResult[]> {
    return rerankResults(query, results, this.embeddingModelId, limit)
  }

  /**
   * find all mdx files in the docs directory
   */
  private async findMdxFiles(): Promise<string[]> {
    const files: string[] = []

    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const path = join(dir, entry.name)

        if (entry.isDirectory()) {
          // skip node_modules and hidden directories
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            await walk(path)
          }
        } else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
          files.push(path)
        }
      }
    }

    await walk(this.docsPath)
    return files
  }

  /**
   * create chunks from a parsed mdx document
   */
  private createChunks(doc: MdxDocument): Omit<DocChunk, "vector">[] {
    const chunks: Omit<DocChunk, "vector">[] = []

    for (const section of doc.sections) {
      // skip empty sections
      if (!section.content.trim()) continue

      // split large sections into smaller chunks
      const sectionChunks = this.splitContent(section.content, 1000)

      for (let i = 0; i < sectionChunks.length; i++) {
        const chunkContent = sectionChunks[i]!
        chunks.push({
          content: chunkContent,
          id: `${doc.path}#${section.id}${sectionChunks.length > 1 ? `-${i}` : ""}`,
          path: doc.path,
          section: section.heading,
        })
      }
    }

    return chunks
  }

  /**
   * split content into chunks of roughly equal size
   */
  private splitContent(content: string, maxChars: number): string[] {
    if (content.length <= maxChars) return [content]

    const chunks: string[] = []
    const paragraphs = content.split(PARAGRAPH_SPLIT_REGEX)
    let current = ""

    for (const paragraph of paragraphs) {
      if (current.length + paragraph.length > maxChars && current.length > 0) {
        chunks.push(current.trim())
        current = paragraph
      } else {
        current += (current ? "\n\n" : "") + paragraph
      }
    }

    if (current.trim()) {
      chunks.push(current.trim())
    }

    return chunks
  }
}

/**
 * compute diff between current doc files and manifest
 */
export function diffDocFiles(
  currentFiles: Map<string, string>,
  manifest: EmbeddingManifest,
): ManifestDiff {
  return diffManifest(currentFiles, manifest.docs)
}
