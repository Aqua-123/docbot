import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type { QdrantClient } from "@qdrant/qdrant-js"
import { $ } from "bun"
import { embedText, embedTexts } from "../db/embed"
import {
  diffManifest,
  type EmbeddingManifest,
  hashContent,
  type ManifestDiff,
  removeManifestEntry,
  saveManifest,
  updateManifestEntry,
} from "../db/manifest"
import { deleteCodeChunks, searchCode, upsertCodeChunks } from "../db/qdrant"
import { rerankResults } from "../db/rerank"
import { logInfo, timed } from "../logger"
import type { CodeChunk, SearchResult } from "../types"

// file extensions we support for code embedding
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".vue",
  ".svelte",
])

// directories to always skip
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "target",
  "vendor",
  ".turbo",
  "coverage",
  "generated", // prisma and other generated code
])

// files to always skip
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "go.sum",
])

// pattern for detecting function/class/interface declarations in TS/JS
const TS_SYMBOL_PATTERNS = {
  arrowFunction:
    /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
  class: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
  constExport: /^export\s+(?:const|let)\s+(\w+)/,
  function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
  interface: /^(?:export\s+)?interface\s+(\w+)/,
  type: /^(?:export\s+)?type\s+(\w+)/,
}

interface SymbolInfo {
  name: string
  type: CodeChunk["symbolType"]
  startLine: number
  endLine: number
  content: string
}

/**
 * code index for embedding and searching codebase files
 */
export class CodeIndex {
  constructor(
    private client: QdrantClient,
    private codebasePaths: string[],
    private docsPath?: string,
    private collectionName?: string,
  ) {}

  /**
   * scan all code files and compute hashes for diffing
   */
  async scanFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>()

    for (const basePath of this.codebasePaths) {
      const codeFiles = await this.findCodeFiles(basePath)

      for (const filePath of codeFiles) {
        // use relative path as key for consistency
        const relativePath = relative(basePath, filePath)
        const prefixedPath = `${basePath}:${relativePath}`

        const content = await Bun.file(filePath).text()
        const hash = hashContent(content)
        files.set(prefixedPath, hash)
      }
    }

    return files
  }

  /**
   * sync code embeddings based on manifest diff
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
    const totalFiles =
      diff.added.length + diff.changed.length + diff.removed.length
    let processedFiles = 0
    let totalChunks = 0

    processedFiles = await this.handleRemovedFiles(
      diff,
      manifest,
      totalFiles,
      processedFiles,
    )

    const changedResult = await this.handleChangedFiles(
      diff,
      fileHashes,
      manifest,
      totalFiles,
      processedFiles,
    )
    processedFiles = changedResult.processedFiles
    totalChunks += changedResult.chunks

    const addedResult = await this.handleAddedFiles(
      diff,
      fileHashes,
      manifest,
      manifestPath,
      totalFiles,
      processedFiles,
    )
    processedFiles = addedResult.processedFiles
    totalChunks += addedResult.chunks

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

  private getDisplayPath(path: string): string {
    const colonIndex = path.indexOf(":")
    return colonIndex > 0 ? path.slice(colonIndex + 1) : path
  }

  private async handleRemovedFiles(
    diff: ManifestDiff,
    manifest: EmbeddingManifest,
    totalFiles: number,
    processedFiles: number,
  ) {
    if (diff.removed.length === 0) return processedFiles

    console.info(`  removing ${diff.removed.length} deleted files...`)
    let processedCount = processedFiles
    for (const path of diff.removed) {
      const displayPath = this.getDisplayPath(path)
      await deleteCodeChunks(this.client, path, this.collectionName)
      removeManifestEntry(manifest, "code", path)
      processedCount++
      process.stdout.write(
        `\x1b[2K\r    [${processedCount}/${totalFiles}] removed ${displayPath}`,
      )
    }
    process.stdout.write("\x1b[2K\r")
    return processedCount
  }

  private async handleChangedFiles(
    diff: ManifestDiff,
    fileHashes: Map<string, string>,
    manifest: EmbeddingManifest,
    totalFiles: number,
    processedFiles: number,
  ) {
    if (diff.changed.length === 0) {
      return { chunks: 0, processedFiles }
    }

    console.info(`  updating ${diff.changed.length} changed files...`)
    let chunks = 0
    let processedCount = processedFiles

    for (const path of diff.changed) {
      const fileStart = performance.now()
      const displayPath = this.getDisplayPath(path)
      await deleteCodeChunks(this.client, path, this.collectionName)
      const fileChunks = await this.embedFile(path)
      chunks += fileChunks
      updateManifestEntry(
        manifest,
        "code",
        path,
        fileHashes.get(path)!,
        fileChunks,
      )
      processedCount++
      const fileDuration = ((performance.now() - fileStart) / 1000).toFixed(1)
      process.stdout.write(
        `\x1b[2K\r    [${processedCount}/${totalFiles}] updated ${displayPath} (${fileChunks} chunks, ${fileDuration}s)`,
      )
    }
    process.stdout.write("\x1b[2K\r")
    return { chunks, processedFiles: processedCount }
  }

  private async handleAddedFiles(
    diff: ManifestDiff,
    fileHashes: Map<string, string>,
    manifest: EmbeddingManifest,
    manifestPath: string | undefined,
    totalFiles: number,
    processedFiles: number,
  ) {
    if (diff.added.length === 0) {
      return { chunks: 0, processedFiles }
    }

    console.info(`  adding ${diff.added.length} new files...`)
    let chunks = 0
    let processedCount = processedFiles

    for (let i = 0; i < diff.added.length; i++) {
      const path = diff.added[i]!
      const fileStart = performance.now()
      const displayPath = this.getDisplayPath(path)
      const fileChunks = await this.embedFile(path)
      chunks += fileChunks
      updateManifestEntry(
        manifest,
        "code",
        path,
        fileHashes.get(path)!,
        fileChunks,
      )
      processedCount++
      const fileDuration = ((performance.now() - fileStart) / 1000).toFixed(1)
      process.stdout.write(
        `\x1b[2K\r    [${processedCount}/${totalFiles}] added ${displayPath} (${fileChunks} chunks, ${fileDuration}s)`,
      )
      if (manifestPath && (i % 50 === 0 || i === diff.added.length - 1)) {
        await saveManifest(manifestPath, manifest).catch(() => {
          // ignore save errors during processing
        })
      }
    }
    process.stdout.write("\x1b[2K\r")
    return { chunks, processedFiles: processedCount }
  }

  /**
   * embed a single code file
   */
  private async embedFile(prefixedPath: string): Promise<number> {
    // parse prefixed path: "basePath:relativePath"
    const colonIndex = prefixedPath.indexOf(":")
    const basePath = prefixedPath.slice(0, colonIndex)
    const relativePath = prefixedPath.slice(colonIndex + 1)
    const fullPath = join(basePath, relativePath)

    const content = await Bun.file(fullPath).text()
    const language = this.detectLanguage(fullPath)

    // extract symbols from the code
    const symbols = this.extractSymbols(content, language)

    if (symbols.length === 0) {
      // fallback: chunk by lines if no symbols detected
      const chunks = this.chunkByLines(content, prefixedPath, language)
      if (chunks.length === 0) return 0

      const texts = chunks.map((c) => c.content)
      const embeddings = await timed(
        "embed",
        `embedding ${chunks.length} line chunks from ${relativePath}`,
        () => embedTexts(texts),
      )

      const chunksWithVectors: CodeChunk[] = chunks.map((chunk, i) => ({
        ...chunk,
        vector: embeddings[i]!,
      }))

      await upsertCodeChunks(
        this.client,
        chunksWithVectors,
        this.collectionName,
      )
      return chunks.length
    }

    // create chunks from symbols
    const chunks = symbols.map((sym) => ({
      content: sym.content,
      endLine: sym.endLine,
      id: `${prefixedPath}#${sym.name}:${sym.startLine}`,
      language,
      path: prefixedPath,
      startLine: sym.startLine,
      symbol: sym.name,
      symbolType: sym.type,
    }))

    // embed all chunks
    const texts = chunks.map((c) => c.content)
    const embeddings = await timed(
      "embed",
      `embedding ${chunks.length} symbols from ${relativePath}`,
      () => embedTexts(texts),
    )

    const chunksWithVectors: CodeChunk[] = chunks.map((chunk, i) => ({
      ...chunk,
      vector: embeddings[i]!,
    }))

    await upsertCodeChunks(this.client, chunksWithVectors, this.collectionName)
    return chunks.length
  }

  /**
   * find all code files in a directory
   */
  private async findCodeFiles(basePath: string): Promise<string[]> {
    const files: string[] = []

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep traversal logic centralized
    const walk = async (dir: string) => {
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return // skip unreadable directories
      }

      for (const entry of entries) {
        const entryName = entry.name
        const path = join(dir, entryName)

        if (entry.isDirectory()) {
          // skip excluded directories
          if (SKIP_DIRS.has(entryName) || entryName.startsWith(".")) {
            continue
          }
          await walk(path)
        } else if (entry.isFile()) {
          // skip excluded files
          if (SKIP_FILES.has(entryName)) continue

          // skip docs files if docsPath is set (avoid duplication)
          if (this.docsPath && path.startsWith(this.docsPath)) {
            const ext = extname(entryName)
            if (ext === ".md" || ext === ".mdx") continue
          }

          // check extension
          const ext = extname(entryName)
          if (CODE_EXTENSIONS.has(ext)) {
            // skip very large files (>500KB)
            const file = Bun.file(path)
            if ((await file.exists()) && file.size < 500 * 1024) {
              files.push(path)
            }
          }
        }
      }
    }

    await walk(basePath)
    return files
  }

  /**
   * detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = extname(filePath)
    const langMap: Record<string, string> = {
      ".c": "c",
      ".cjs": "javascript",
      ".cpp": "cpp",
      ".cs": "csharp",
      ".go": "go",
      ".h": "c",
      ".hpp": "cpp",
      ".java": "java",
      ".js": "javascript",
      ".jsx": "javascript",
      ".kt": "kotlin",
      ".mjs": "javascript",
      ".php": "php",
      ".py": "python",
      ".rb": "ruby",
      ".rs": "rust",
      ".svelte": "svelte",
      ".swift": "swift",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".vue": "vue",
    }
    return langMap[ext] ?? "unknown"
  }

  /**
   * extract symbols (functions, classes, etc.) from code
   */
  private extractSymbols(content: string, language: string): SymbolInfo[] {
    if (language === "typescript" || language === "javascript") {
      return this.extractTsSymbols(content)
    }

    // for other languages, fall back to line-based chunking
    return []
  }

  /**
   * extract symbols from TypeScript/JavaScript code
   */
  private extractTsSymbols(content: string): SymbolInfo[] {
    const lines = content.split("\n")
    const symbols: SymbolInfo[] = []

    let i = 0
    while (i < lines.length) {
      const line = lines[i]!
      const trimmed = line.trim()

      // skip empty lines and comments
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        i++
        continue
      }

      // try to match symbol patterns
      let matched = false
      for (const [type, pattern] of Object.entries(TS_SYMBOL_PATTERNS)) {
        const match = trimmed.match(pattern)
        if (match) {
          const name = match[1]!
          const startLine = i + 1

          // find the end of this symbol (balanced braces or arrow function body)
          const endLine = this.findSymbolEnd(lines, i)

          // extract content
          const symbolContent = lines.slice(i, endLine).join("\n")

          // skip very small symbols (less than 2 lines)
          if (endLine - i >= 2) {
            symbols.push({
              content: symbolContent,
              endLine,
              name,
              startLine,
              type: this.mapSymbolType(type),
            })
          }

          i = endLine
          matched = true
          break
        }
      }

      if (!matched) {
        i++
      }
    }

    return symbols
  }

  /**
   * find the end line of a symbol definition
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: brace parsing favors readability
  private findSymbolEnd(lines: string[], startIdx: number): number {
    let braceCount = 0
    let foundOpenBrace = false

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]!

      for (const char of line) {
        if (char === "{") {
          braceCount++
          foundOpenBrace = true
        } else if (char === "}") {
          braceCount--
        }
      }

      // if we found braces and they're balanced, we're done
      if (foundOpenBrace && braceCount === 0) {
        return i + 1
      }

      // for arrow functions without braces, end at the line
      if (!foundOpenBrace && i > startIdx) {
        const trimmed = line.trim()
        // if line ends with semicolon or is empty, we're probably done
        if (trimmed.endsWith(";") || trimmed === "") {
          return i + 1
        }
      }
    }

    // default: 50 lines or end of file
    return Math.min(startIdx + 50, lines.length)
  }

  /**
   * map pattern key to symbol type
   */
  private mapSymbolType(patternKey: string): CodeChunk["symbolType"] {
    const map: Record<string, CodeChunk["symbolType"]> = {
      arrowFunction: "function",
      class: "class",
      constExport: "const",
      function: "function",
      interface: "interface",
      type: "type",
    }
    return map[patternKey] ?? "block"
  }

  /**
   * semantic search over code embeddings
   */
  async semanticSearch(
    query: string,
    limit = 5,
    filter?: { path?: string; language?: string },
  ): Promise<SearchResult[]> {
    logInfo(`code semantic search: "${query.slice(0, 50)}..."`)
    const queryVector = await timed(
      "embed",
      `embedding code query "${query.slice(0, 50)}..."`,
      () => embedText(query),
    )

    const results = await timed(
      "qdrant",
      `searching ${limit} code chunks`,
      () =>
        searchCode(
          this.client,
          queryVector,
          limit,
          filter,
          this.collectionName,
        ),
    )
    return results
  }

  /**
   * exact text search in code using ripgrep
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: preserves existing search flow
  async exactSearch(query: string, limit = 10): Promise<SearchResult[]> {
    logInfo(`code text search: "${query}"`)
    const matches: SearchResult[] = []

    for (const codebasePath of this.codebasePaths) {
      const args = [
        "--json",
        "--max-count",
        String(limit * 2),
        "--smart-case",
        query,
        codebasePath,
      ]

      try {
        const result = await $`rg ${args}`.quiet()
        const lines = result.stdout
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
            const lineNumber = parsed.data?.line_number ?? 0

            matches.push({
              content,
              id: `text-${path}-${lineNumber}`,
              path,
              score: 1,
              section: "",
            })

            if (matches.length >= limit) break
          } catch {
            // skip malformed lines
          }
        }
      } catch (error) {
        // ripgrep returns non-zero when no matches; ignore
        if (
          !(
            error instanceof Error &&
            error.message &&
            error.message.includes("exit code")
          )
        ) {
          console.error("ripgrep failed", error)
        }
      }

      if (matches.length >= limit) break
    }

    return matches.slice(0, limit)
  }

  /**
   * hybrid search: semantic + rerank
   */
  async hybridSearch(query: string, limit = 5): Promise<SearchResult[]> {
    logInfo(`code hybrid search: "${query.slice(0, 50)}..."`)
    const semanticResults = await this.semanticSearch(query, limit * 2)
    return rerankResults(query, semanticResults, limit)
  }

  /**
   * fallback: chunk code by lines when symbol extraction fails
   */
  private chunkByLines(
    content: string,
    path: string,
    language: string,
  ): Omit<CodeChunk, "vector">[] {
    const lines = content.split("\n")
    const chunks: Omit<CodeChunk, "vector">[] = []

    const CHUNK_SIZE = 60
    const OVERLAP = 10

    let i = 0
    let chunkIndex = 0

    while (i < lines.length) {
      const endLine = Math.min(i + CHUNK_SIZE, lines.length)
      const chunkContent = lines.slice(i, endLine).join("\n").trim()

      if (chunkContent.length > 50) {
        chunks.push({
          content: chunkContent,
          endLine,
          id: `${path}#chunk:${chunkIndex}`,
          language,
          path,
          startLine: i + 1,
          symbol: `lines ${i + 1}-${endLine}`,
          symbolType: "block",
        })
        chunkIndex++
      }

      i += CHUNK_SIZE - OVERLAP
    }

    return chunks
  }
}

/**
 * compute diff between current code files and manifest
 */
export function diffCodeFiles(
  currentFiles: Map<string, string>,
  manifest: EmbeddingManifest,
): ManifestDiff {
  return diffManifest(currentFiles, manifest.code)
}
