import type { CodeIndex } from "../../index/code-index"
import { createFeatureStatusTool } from "./feature-status"
import { createFindComponentsTool } from "./find-components"
import { createGetRoutesTool } from "./get-routes"
import { createListDirectoryTool } from "./list-directory"
import { createReadFileTool } from "./read-file"
import { createCodeSearchTool } from "./search"
import { createSemanticCodeSearchTool } from "./semantic-search"

/**
 * create all codebase tools with the given context
 *
 * accepts an array of paths to search across (supports multiple directories)
 */
export function createCodebaseTools(
  codebasePaths: string[],
  codeIndex: CodeIndex,
) {
  return {
    code_search: createCodeSearchTool(codebasePaths),
    feature_status: createFeatureStatusTool(codebasePaths),
    find_components: createFindComponentsTool(codebasePaths),
    get_routes: createGetRoutesTool(codebasePaths),
    list_directory: createListDirectoryTool(codebasePaths),
    read_file: createReadFileTool(codebasePaths),
    semantic_code_search: createSemanticCodeSearchTool(codeIndex),
  }
}

export type CodebaseTools = ReturnType<typeof createCodebaseTools>
