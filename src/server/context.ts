import type { QdrantClient } from "@qdrant/qdrant-js"
import type { CodeIndex } from "../index/code-index"
import type { DocIndex } from "../index/doc-index"
import type { ServerContext } from "../types"

/**
 * shared server context containing all dependencies
 */
export interface AppContext extends ServerContext {
  qdrantClient: QdrantClient
  docIndex: DocIndex
  codeIndex: CodeIndex
}

/**
 * create a context object to pass through routes
 */
export function createAppContext(
  qdrantClient: QdrantClient,
  docIndex: DocIndex,
  codeIndex: CodeIndex,
  options: {
    docsPath: string
    codebasePaths: string[]
    qdrantUrl: string
    interactive: boolean
  },
): AppContext {
  return {
    codebasePaths: options.codebasePaths,
    codeIndex,
    docIndex,
    docsPath: options.docsPath,
    interactive: options.interactive,
    qdrantClient,
    qdrantUrl: options.qdrantUrl,
  }
}
