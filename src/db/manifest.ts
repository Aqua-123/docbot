import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

// individual file entry in the manifest
export interface EmbeddedFile {
  hash: string
  chunkCount: number
  embeddedAt: number
}

// full manifest structure
export interface EmbeddingManifest {
  version: number
  docs: Record<string, EmbeddedFile>
  code: Record<string, EmbeddedFile>
}

// result of diffing current files against manifest
export interface ManifestDiff {
  added: string[]
  changed: string[]
  removed: string[]
  unchanged: string[]
}

const MANIFEST_VERSION = 1

/**
 * compute sha256 hash of file content
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * load manifest from disk, or return empty manifest if not found/corrupt
 */
export async function loadManifest(path: string): Promise<EmbeddingManifest> {
  try {
    if (!existsSync(path)) {
      return createEmptyManifest()
    }

    const raw = await readFile(path, "utf-8")
    const parsed = JSON.parse(raw) as EmbeddingManifest

    // validate version
    if (parsed.version !== MANIFEST_VERSION) {
      console.warn(
        `manifest version mismatch (got ${parsed.version}, expected ${MANIFEST_VERSION}), re-indexing`,
      )
      return createEmptyManifest()
    }

    return parsed
  } catch (error) {
    console.warn("failed to load manifest, will re-index:", error)
    return createEmptyManifest()
  }
}

/**
 * save manifest to disk
 */
export async function saveManifest(
  path: string,
  manifest: EmbeddingManifest,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(manifest, null, 2))
}

/**
 * create an empty manifest
 */
function createEmptyManifest(): EmbeddingManifest {
  return {
    code: {},
    docs: {},
    version: MANIFEST_VERSION,
  }
}

/**
 * diff current files against manifest to find what needs updating
 *
 * @param currentFiles - map of file path to content hash
 * @param manifestFiles - the relevant section of the manifest (docs or code)
 */
export function diffManifest(
  currentFiles: Map<string, string>,
  manifestFiles: Record<string, EmbeddedFile>,
): ManifestDiff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  const unchanged: string[] = []

  // check each current file
  for (const [path, hash] of currentFiles) {
    const existing = manifestFiles[path]

    if (!existing) {
      added.push(path)
    } else if (existing.hash !== hash) {
      changed.push(path)
    } else {
      unchanged.push(path)
    }
  }

  // find removed files (in manifest but not in current)
  for (const path of Object.keys(manifestFiles)) {
    if (!currentFiles.has(path)) {
      removed.push(path)
    }
  }

  return { added, changed, removed, unchanged }
}

/**
 * update manifest entry for a file
 */
export function updateManifestEntry(
  manifest: EmbeddingManifest,
  type: "docs" | "code",
  path: string,
  hash: string,
  chunkCount: number,
): void {
  manifest[type][path] = {
    chunkCount,
    embeddedAt: Date.now(),
    hash,
  }
}

/**
 * remove a file from the manifest
 */
export function removeManifestEntry(
  manifest: EmbeddingManifest,
  type: "docs" | "code",
  path: string,
): void {
  delete manifest[type][path]
}
