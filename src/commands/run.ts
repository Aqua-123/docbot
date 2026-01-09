import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { render } from "ink"
import React from "react"
import type { CommandModule } from "yargs"
import {
  createRuntimeConfig,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
  loadConfig,
} from "../config"
import type { EmbeddingManifest } from "../db/manifest"
import { loadManifest, saveManifest } from "../db/manifest"
import { initQdrant } from "../db/qdrant"
import { CodeIndex, diffCodeFiles } from "../index/code-index"
import { DocIndex, diffDocFiles } from "../index/doc-index"
import {
  enableUiMode,
  muteConsoleForCategory,
  setVerbose,
  startLogServer,
} from "../logger"
import { startServer } from "../server"
import { createAppContext } from "../server/context"
import { App } from "../ui/app"
import { expandCodebasePaths } from "./utils"

export interface RunArgs {
  task?: string
  docs: string
  codebase?: string
  config?: string
  interactive: boolean
  port?: number
  qdrantUrl?: string
  indexOnly: boolean
  verbose: boolean
  noServer: boolean
  force: boolean
}

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>
type IndexStats = {
  added: number
  changed: number
  chunks: number
  removed: number
  scanned: number
  unchanged: number
}

function ensureApiKey() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error("error: AI_GATEWAY_API_KEY environment variable is required")
    process.exit(1)
  }
}

async function resolvePaths(args: RunArgs) {
  const resolvedConfig = await loadConfig({
    configPath: args.config,
    overrides: {
      codebase: args.codebase,
      docs: args.docs,
      port: args.port,
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
  codebasePaths: string[],
  resolvedConfig: LoadedConfig,
  args: RunArgs,
) {
  console.info("initializing docbot...")
  console.info(`  docs: ${docsPath}`)
  console.info(`  project: ${resolvedConfig.projectSlug}`)
  if (codebasePaths.length > 0) {
    console.info("  codebase paths:")
    for (const p of codebasePaths) {
      console.info(`    - ${p}`)
    }
  }
  if (args.verbose) {
    console.info("  verbose: enabled")
  }
  if (args.force) {
    console.info("  force: full re-index")
  }
}

async function syncDocsIndex(
  docIndex: DocIndex,
  manifest: EmbeddingManifest,
  manifestPath: string,
): Promise<IndexStats> {
  const docsScanStart = performance.now()
  console.info("scanning documentation...")
  const docFiles = await docIndex.scanFiles()
  const docDiff = diffDocFiles(docFiles, manifest)
  const docsScanDuration = ((performance.now() - docsScanStart) / 1000).toFixed(
    1,
  )

  let chunks = 0
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
    chunks = docResult.chunks
    console.info(`  ✓ synced ${docResult.chunks} chunks`)
  } else {
    console.info(
      `  docs: ${docDiff.unchanged.length} files unchanged (scanned in ${docsScanDuration}s)`,
    )
  }

  return {
    added: docDiff.added.length,
    changed: docDiff.changed.length,
    chunks,
    removed: docDiff.removed.length,
    scanned: docFiles.size,
    unchanged: docDiff.unchanged.length,
  }
}

async function syncCodeIndex(
  codeIndex: CodeIndex,
  manifest: EmbeddingManifest,
  manifestPath: string,
  hasCodebase: boolean,
): Promise<IndexStats | undefined> {
  if (!hasCodebase) return undefined

  const codeScanStart = performance.now()
  console.info("scanning codebase...")
  const codeFiles = await codeIndex.scanFiles()
  const codeDiff = diffCodeFiles(codeFiles, manifest)
  const codeScanDuration = ((performance.now() - codeScanStart) / 1000).toFixed(
    1,
  )

  let chunks = 0
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
    chunks = codeResult.chunks
    console.info(`  ✓ synced ${codeResult.chunks} chunks`)
  } else {
    console.info(
      `  code: ${codeDiff.unchanged.length} files unchanged (scanned in ${codeScanDuration}s)`,
    )
  }

  return {
    added: codeDiff.added.length,
    changed: codeDiff.changed.length,
    chunks,
    removed: codeDiff.removed.length,
    scanned: codeFiles.size,
    unchanged: codeDiff.unchanged.length,
  }
}

function registerManifestExitHandlers(
  manifestPath: string,
  manifest: EmbeddingManifest,
) {
  const saveManifestOnExit = async () => {
    try {
      await saveManifest(manifestPath, manifest)
    } catch {
      // ignore errors during exit
    }
    process.exit(0)
  }
  process.on("SIGINT", saveManifestOnExit)
  process.on("SIGTERM", saveManifestOnExit)
}

export const runCommand: CommandModule<object, RunArgs> = {
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
    "index-only": {
      default: false,
      describe: "only index the docs, don't run the agent",
      type: "boolean",
    },
    interactive: {
      default: true,
      describe: "run in interactive mode with plan approval",
      type: "boolean",
    },
    "no-server": {
      alias: "ns",
      default: false,
      describe: "don't start the server (connect to existing server instead)",
      type: "boolean",
    },
    port: {
      describe: `server port (default: ${DEFAULT_SERVER_PORT})`,
      type: "number",
    },
    "qdrant-url": {
      describe: `qdrant server url (default: ${DEFAULT_QDRANT_URL})`,
      type: "string",
    },
    task: {
      describe:
        "the documentation task to perform (optional - starts in idle mode if omitted)",
      type: "string",
    },
    verbose: {
      alias: "v",
      default: false,
      describe: "show detailed logging of tool calls, commands, and timings",
      type: "boolean",
    },
  },
  command: "run [task]",
  describe: "run the documentation agent",

  handler: async (args) => {
    // enable verbose logging (but not UI mode yet - we want to see indexing progress)
    setVerbose(args.verbose)
    if (args.verbose) {
      startLogServer()
    }

    ensureApiKey()

    const {
      codebasePaths,
      docsPath,
      manifestPath,
      resolvedConfig,
      runtimeConfig,
    } = await resolvePaths(args)

    await mkdir(dirname(manifestPath), { recursive: true })
    logInitialization(docsPath, codebasePaths, resolvedConfig, args)

    console.info("connecting to qdrant...")
    const qdrantClient = await initQdrant(resolvedConfig.qdrant.url, {
      code: runtimeConfig.qdrant.collections.code.name,
      docs: runtimeConfig.qdrant.collections.docs.name,
    })

    const manifest: EmbeddingManifest = args.force
      ? { code: {}, docs: {}, version: 1 }
      : await loadManifest(manifestPath)

    registerManifestExitHandlers(manifestPath, manifest)

    const docIndex = new DocIndex(
      qdrantClient,
      docsPath,
      runtimeConfig.qdrant.collections.docs.name,
      runtimeConfig.models.embedding,
    )
    const codeIndex = new CodeIndex(
      qdrantClient,
      codebasePaths,
      runtimeConfig.qdrant.collections.code.name,
      runtimeConfig.models.embedding,
      docsPath,
    )

    const docStats = await syncDocsIndex(docIndex, manifest, manifestPath)
    const codeStats = await syncCodeIndex(
      codeIndex,
      manifest,
      manifestPath,
      codebasePaths.length > 0,
    )

    await saveManifest(manifestPath, manifest)

    if (args.indexOnly) {
      console.info("indexing complete")
      process.exit(0)
    }

    const ctx = createAppContext(runtimeConfig, qdrantClient, docIndex, codeIndex, {
      codebasePaths,
      docsPath,
      interactive: args.interactive,
      qdrantUrl: resolvedConfig.qdrant.url,
    })

    const serverPort = resolvedConfig.server.port

    if (!args.noServer) {
      muteConsoleForCategory("elysia")
      startServer(ctx, serverPort)
    } else {
      console.info(
        `connecting to existing server at http://localhost:${serverPort}`,
      )
    }

    enableUiMode()
    process.stdout.write("\x1b[2J\x1b[H")

    const { waitUntilExit } = render(
      React.createElement(App, {
        codebasePaths,
        docsPath,
        indexingStats: {
          code: codeStats,
          docs: docStats,
        },
        serverPort,
        task: args.task,
      }),
    )

    await waitUntilExit()
  },
}
