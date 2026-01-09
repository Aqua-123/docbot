import { resolve } from "node:path"
import type { CommandModule } from "yargs"
import {
  createRuntimeConfig,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
  loadConfig,
} from "../config"
import { initQdrant } from "../db/qdrant"
import { CodeIndex } from "../index/code-index"
import { DocIndex } from "../index/doc-index"
import { startServer } from "../server"
import { createAppContext } from "../server/context"
import { expandCodebasePaths } from "./utils"

export interface ServeArgs {
  docs: string
  codebase?: string
  config?: string
  interactive: boolean
  port?: number
  qdrantUrl?: string
}

export const serveCommand: CommandModule<object, ServeArgs> = {
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
    interactive: {
      default: true,
      describe: "enable interactive mode (allows agent to ask questions)",
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
  },
  command: "serve",
  describe: "start the docbot server without the interactive ui",

  handler: async (args) => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.error(
        "error: AI_GATEWAY_API_KEY environment variable is required",
      )
      process.exit(1)
    }

    // load configuration
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

    console.info("initializing docbot server...")
    console.info(`  docs: ${docsPath}`)
    console.info(`  project: ${resolvedConfig.projectSlug}`)
    if (codebasePaths.length > 0) {
      console.info("  codebase paths:")
      for (const p of codebasePaths) {
        console.info(`    - ${p}`)
      }
    }
    console.info(`  interactive: ${args.interactive}`)

    // initialize qdrant
    console.info("connecting to qdrant...")
    const qdrantClient = await initQdrant(resolvedConfig.qdrant.url, {
      code: runtimeConfig.qdrant.collections.code.name,
      docs: runtimeConfig.qdrant.collections.docs.name,
    })

    // create indexes with collection names from config
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

    // create context
    const ctx = createAppContext(runtimeConfig, qdrantClient, docIndex, codeIndex, {
      codebasePaths,
      docsPath,
      interactive: args.interactive,
      qdrantUrl: resolvedConfig.qdrant.url,
    })

    // start server
    startServer(ctx, resolvedConfig.server.port)

    console.info("server ready to accept requests")
  },
}
