import type { QdrantClient } from "@qdrant/qdrant-js"
import type { DocIndex } from "../../index/doc-index"
import { createAnalyzeDocTool, createCheckCoverageTool } from "./analyze"
import { createAddSectionTool, createDocTool } from "./create"
import { createDeleteDocTool, createDeleteSectionTool } from "./delete"
import { createSearchMintlifyTool } from "./mintlify"
import { createMoveContentTool, createMoveSectionTool } from "./move"
import { createGetOutlineTool, createReadDocTool } from "./read"
import { createReadNavTool } from "./read-nav"
import { createRegisterNavTool } from "./register-nav"
import { createConsolidateDocsTool, createRenameDocTool } from "./reorganize"
import { createSearchDocsTool } from "./search"
import { createUpdateSectionTool } from "./update"
import { createUpdateNavTool } from "./update-nav"

/**
 * create all doc tools with the given context
 */
export function createDocTools(
  docsPath: string,
  docIndex: DocIndex,
  qdrantClient: QdrantClient,
  collectionName: string,
) {
  return {
    add_section: createAddSectionTool(docsPath, docIndex),
    analyze_doc: createAnalyzeDocTool(docsPath, docIndex),
    check_coverage: createCheckCoverageTool(docsPath, docIndex),
    consolidate_docs: createConsolidateDocsTool(docsPath, docIndex),
    create_doc: createDocTool(docsPath, docIndex),
    delete_doc: createDeleteDocTool(docsPath, qdrantClient, collectionName),
    delete_section: createDeleteSectionTool(docsPath, docIndex),
    get_doc_outline: createGetOutlineTool(docsPath),
    move_content: createMoveContentTool(docsPath, docIndex),
    move_section: createMoveSectionTool(docsPath, docIndex),
    read_doc: createReadDocTool(docsPath),
    read_nav: createReadNavTool(docsPath),
    register_nav: createRegisterNavTool(docsPath),
    rename_doc: createRenameDocTool(docsPath, docIndex, qdrantClient, collectionName),
    search_docs: createSearchDocsTool(docIndex),
    search_mintlify: createSearchMintlifyTool(),
    update_nav: createUpdateNavTool(docsPath),
    update_section: createUpdateSectionTool(docsPath, docIndex),
  }
}

export type DocTools = ReturnType<typeof createDocTools>
