import { resolve } from "node:path"
import type { CommandModule } from "yargs"
import { createRuntimeConfig, DEFAULT_QDRANT_URL, loadConfig } from "../config"
import { initQdrant } from "../db/qdrant"
import { DocIndex } from "../index/doc-index"
import type { SearchResult } from "../types"

export interface SearchArgs {
  query: string
  docs: string
  config?: string
  type: "semantic" | "exact" | "hybrid"
  limit: number
  qdrantUrl?: string
}

export const searchCommand: CommandModule<object, SearchArgs> = {
  builder: {
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
    limit: {
      default: 5,
      describe: "max results to return",
      type: "number",
    },
    "qdrant-url": {
      describe: `qdrant server url (default: ${DEFAULT_QDRANT_URL})`,
      type: "string",
    },
    query: {
      demandOption: true,
      describe: "the search query",
      type: "string",
    },
    type: {
      choices: ["semantic", "exact", "hybrid"] as const,
      default: "hybrid" as const,
      describe: "search type: semantic, exact, or hybrid",
      type: "string",
    },
  },
  command: "search <query>",
  describe: "search documentation",

  handler: async (args) => {
    // check env
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.error(
        "error: AI_GATEWAY_API_KEY environment variable is required",
      )
      process.exit(1)
    }

    const resolvedConfig = await loadConfig({
      configPath: args.config,
      overrides: {
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

    // load configuration
    const runtimeConfig = createRuntimeConfig(resolvedConfig)

    // initialize qdrant
    const qdrantClient = await initQdrant(resolvedConfig.qdrant.url, {
      code: runtimeConfig.qdrant.collections.code.name,
      docs: runtimeConfig.qdrant.collections.docs.name,
    })

    // create doc index with collection name from config
    const docIndex = new DocIndex(
      qdrantClient,
      docsPath,
      runtimeConfig.qdrant.collections.docs.name,
    )

    // search
    let results: SearchResult[]
    if (args.type === "semantic") {
      results = await docIndex.semanticSearch(args.query, args.limit)
    } else if (args.type === "exact") {
      results = await docIndex.exactSearch(args.query, args.limit)
    } else {
      results = await docIndex.hybridSearch(args.query, args.limit)
    }

    // output results
    console.log(`\nfound ${results.length} results for "${args.query}":\n`)

    for (const result of results) {
      console.log(`[${result.score.toFixed(3)}] ${result.path}`)
      if (result.section) {
        console.log(`        section: ${result.section}`)
      }
      console.log(`        ${result.content.slice(0, 150)}...`)
      console.log()
    }
  },
}
