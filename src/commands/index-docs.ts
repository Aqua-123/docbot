import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { CommandModule } from "yargs"
import { createRuntimeConfig, DEFAULT_QDRANT_URL, loadConfig } from "../config"
import { loadManifest, saveManifest } from "../db/manifest"
import { initQdrant } from "../db/qdrant"
import { CodeIndex, diffCodeFiles } from "../index/code-index"
import { DocIndex, diffDocFiles } from "../index/doc-index"
import { expandCodebasePaths } from "./utils"

function requireApiKey() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error("error: AI_GATEWAY_API_KEY environment variable is required")
    process.exit(1)
  }
}

async function resolveConfigPaths(args: IndexArgs) {
  const resolvedConfig = await loadConfig({
    configPath: args.config,
    overrides: {
      codebase: args.codebase,
      docs: args.docs,
      qdrantUrl: args.qdrantUrl,
    },
    startDir: process.cwd(),
  })

  const docsPathInput = args.docs ?? resolvedConfig.paths.docs
  if (!docsPathInput) {
    console.error(
      "error: docs path is required (provide --docs or set paths.docs in config)",
    )
    process.exit(1)
  }
  const docsPath = resolve(docsPathInput)
  const codebaseInput =
    args.codebase ??
    (resolvedConfig.paths.codebase
      ? resolvedConfig.paths.codebase.join(",")
      : undefined)
  const codebasePaths = await expandCodebasePaths(codebaseInput)
  const runtimeConfig = createRuntimeConfig(resolvedConfig)
  const manifestPath = resolvedConfig.paths.manifest

  return {
    codebasePaths,
    docsPath,
    manifestPath,
    resolvedConfig,
    runtimeConfig,
  }
}

function logInitialization(
  docsPath: string,
  projectSlug: string,
  codebasePaths: string[],
  force: boolean,
) {
  console.info("initializing docbot...")
  console.info(`  docs: ${docsPath}`)
  console.info(`  project: ${projectSlug}`)
  if (codebasePaths.length > 0) {
    console.info("  codebase paths:")
    for (const p of codebasePaths) {
      console.info(`    - ${p}`)
    }
  }
  if (force) {
    console.info("  force: full re-index")
  }
}

function attachManifestSaveHandlers(
  manifestPath: string,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
) {
  const saveManifestOnExit = async () => {
    try {
      await saveManifest(manifestPath, manifest)
    } catch (_error) {
      // ignore errors during exit
    }
    process.exit(0)
  }
  process.on("SIGINT", saveManifestOnExit)
  process.on("SIGTERM", saveManifestOnExit)
}

function createIndexes(
  qdrantClient: Awaited<ReturnType<typeof initQdrant>>,
  docsPath: string,
  codebasePaths: string[],
  runtimeConfig: ReturnType<typeof createRuntimeConfig>,
) {
  const docIndex = new DocIndex(
    qdrantClient,
    docsPath,
    runtimeConfig.qdrant.collections.docs.name,
    runtimeConfig.models.embedding,
  )
  const codeIndex =
    codebasePaths.length > 0
      ? new CodeIndex(
          qdrantClient,
          codebasePaths,
          runtimeConfig.qdrant.collections.code.name,
          runtimeConfig.models.embedding,
          docsPath,
        )
      : null

  return { codeIndex, docIndex }
}

function loadManifestState(
  manifestPath: string,
  force: boolean,
): Promise<Awaited<ReturnType<typeof loadManifest>>> {
  if (force) {
    return Promise.resolve({ code: {}, docs: {}, version: 1 })
  }
  return loadManifest(manifestPath)
}

async function syncDocsWithManifest(
  docIndex: DocIndex,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  manifestPath: string,
) {
  const docsScanStart = performance.now()
  console.info("scanning documentation...")
  const docFiles = await docIndex.scanFiles()
  const docDiff = diffDocFiles(docFiles, manifest)
  const docsScanDuration = ((performance.now() - docsScanStart) / 1000).toFixed(
    1,
  )

  const docsNeedSync =
    docDiff.added.length > 0 ||
    docDiff.changed.length > 0 ||
    docDiff.removed.length > 0

  if (docsNeedSync) {
    console.info(
      `  docs: ${docDiff.added.length} new, ${docDiff.changed.length} changed, ${docDiff.removed.length} removed, ${docDiff.unchanged.length} unchanged (scanned in ${docsScanDuration}s)`,
    )
    console.info("syncing documentation embeddings...")
    const docResult = await docIndex.syncFromDiff(
      docDiff,
      docFiles,
      manifest,
      manifestPath,
    )
    console.info(`  ✓ synced ${docResult.chunks} chunks`)
  } else {
    console.info(
      `  docs: ${docDiff.unchanged.length} files unchanged (scanned in ${docsScanDuration}s)`,
    )
  }
}

async function syncCodeWithManifest(
  codeIndex: CodeIndex,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  manifestPath: string,
) {
  const codeScanStart = performance.now()
  console.info("scanning codebase...")
  const codeFiles = await codeIndex.scanFiles()
  const codeDiff = diffCodeFiles(codeFiles, manifest)
  const codeScanDuration = ((performance.now() - codeScanStart) / 1000).toFixed(
    1,
  )

  const codeNeedSync =
    codeDiff.added.length > 0 ||
    codeDiff.changed.length > 0 ||
    codeDiff.removed.length > 0

  if (codeNeedSync) {
    console.info(
      `  code: ${codeDiff.added.length} new, ${codeDiff.changed.length} changed, ${codeDiff.removed.length} removed, ${codeDiff.unchanged.length} unchanged (scanned in ${codeScanDuration}s)`,
    )
    console.info("syncing codebase embeddings...")
    const codeResult = await codeIndex.syncFromDiff(
      codeDiff,
      codeFiles,
      manifest,
      manifestPath,
    )
    console.info(`  ✓ synced ${codeResult.chunks} chunks`)
  } else {
    console.info(
      `  code: ${codeDiff.unchanged.length} files unchanged (scanned in ${codeScanDuration}s)`,
    )
  }
}

export interface IndexArgs {
  docs: string
  codebase?: string
  config?: string
  qdrantUrl?: string
  force: boolean
}

export const indexCommand: CommandModule<object, IndexArgs> = {
  builder: {
    codebase: {
      describe:
        "comma-separated paths or globs to codebase directories (e.g. 'apps/helm,packages/*'); falls back to paths.codebase in config",
      type: "string",
    },
    config: {
      alias: "c",
      describe: "path to docbot config file",
      type: "string",
    },
    docs: {
      demandOption: false,
      describe:
        "path to the documentation directory (or set paths.docs in config)",
      type: "string",
    },
    force: {
      alias: "f",
      default: false,
      describe: "force full re-index, ignoring manifest",
      type: "boolean",
    },
    "qdrant-url": {
      describe: `qdrant server url (default: ${DEFAULT_QDRANT_URL})`,
      type: "string",
    },
  },
  command: "index",
  describe: "index documentation and codebase files for search",

  handler: async (args) => {
    requireApiKey()

    const {
      codebasePaths,
      docsPath,
      manifestPath,
      resolvedConfig,
      runtimeConfig,
    } = await resolveConfigPaths(args)

    await mkdir(dirname(manifestPath), { recursive: true })

    logInitialization(
      docsPath,
      resolvedConfig.projectSlug,
      codebasePaths,
      args.force,
    )

    console.info("connecting to qdrant...")
    const qdrantClient = await initQdrant(resolvedConfig.qdrant.url, {
      code: runtimeConfig.qdrant.collections.code.name,
      docs: runtimeConfig.qdrant.collections.docs.name,
    })
    const manifest = await loadManifestState(manifestPath, args.force)

    attachManifestSaveHandlers(manifestPath, manifest)

    const { codeIndex, docIndex } = createIndexes(
      qdrantClient,
      docsPath,
      codebasePaths,
      runtimeConfig,
    )

    await syncDocsWithManifest(docIndex, manifest, manifestPath)

    if (codeIndex) {
      await syncCodeWithManifest(codeIndex, manifest, manifestPath)
    }

    await saveManifest(manifestPath, manifest)

    console.info("done")
  },
}
