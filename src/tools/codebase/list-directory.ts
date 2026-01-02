import { readdir } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { z } from "zod"
import { logError, logTool, logToolResult } from "../../logger"

const inputSchema = z.object({
  directoryPath: z
    .string()
    .describe(
      "path to the directory to list. can be absolute or relative to codebase paths. examples: '/Users/celia/.dev/helm/packages/db', 'packages/db', 'apps/helm/features/events'",
    ),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe("if true, recursively list all subdirectories and files"),
})

export const createListDirectoryTool = (codebasePaths: string[]) => ({
  description: `list the contents of a directory.

parameters:
- directoryPath (required): path to directory (absolute or relative to codebase paths)
- recursive (optional, default: false): if true, recursively list all subdirectories and files

use this to explore the directory structure of the codebase. returns files and subdirectories with their types.

examples:
- list directory: directoryPath: 'packages/db'
- list recursively: directoryPath: 'apps/helm/features', recursive: true`,
  execute:
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: maintains current path resolution flow
    async function executeListDirectory({
      directoryPath,
      recursive,
    }: z.infer<typeof inputSchema>) {
      logTool("list_directory", { directoryPath, recursive })
      const start = performance.now()

      // resolve directory path
      let resolvedPath: string | null = null

      if (isAbsolute(directoryPath)) {
        // verify it exists and is a directory by trying to read it
        try {
          await readdir(directoryPath)
          resolvedPath = directoryPath
        } catch {
          // not found or not a directory
        }
      } else {
        // try relative to each codebase path
        for (const codebasePath of codebasePaths) {
          const candidate = resolve(codebasePath, directoryPath)
          // verify it exists by trying to read it
          try {
            await readdir(candidate)
            resolvedPath = candidate
            break
          } catch {
            // continue to next path
          }
        }
      }

      if (!resolvedPath) {
        const error = `directory not found: ${directoryPath}`
        logError(error)
        return {
          directoryPath,
          error,
          found: false,
        }
      }

      try {
        const entries = await readdir(resolvedPath, {
          recursive: recursive ?? false,
          withFileTypes: true,
        })

        const items = entries.map((entry) => {
          // when recursive: true, entry.name is the relative path from resolvedPath
          // when recursive: false, entry.name is just the filename
          const entryPath = entry.name
          const name = recursive
            ? (entryPath.split("/").pop() ?? entryPath)
            : entryPath

          return {
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            name,
            path: entryPath,
            type: entry.isDirectory() ? "directory" : "file",
          }
        })

        // get relative path for display
        let displayPath = resolvedPath
        for (const codebasePath of codebasePaths) {
          if (resolvedPath.startsWith(codebasePath)) {
            displayPath = relative(codebasePath, resolvedPath)
            break
          }
        }

        const result = {
          absolutePath: resolvedPath,
          count: items.length,
          directoryPath: displayPath,
          found: true,
          items,
        }

        logToolResult(result, performance.now() - start)
        return result
      } catch (error) {
        const errorMsg = `failed to list directory: ${resolvedPath}`
        logError(errorMsg, error)
        return {
          directoryPath: resolvedPath,
          error: errorMsg,
          found: true,
        }
      }
    },
  inputSchema,
})
