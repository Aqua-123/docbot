import { isAbsolute, relative, resolve } from "node:path"
import { z } from "zod"
import { logError, logTool, logToolResult } from "../../logger"

const inputSchema = z.object({
  filePath: z
    .string()
    .describe(
      "path to the file to read. can be absolute or relative to codebase paths. examples: '/Users/celia/.dev/helm/packages/db/schema.prisma', 'packages/db/schema.prisma', 'apps/helm/features/events/page.tsx'",
    ),
  lineEnd: z
    .number()
    .optional()
    .describe(
      "optional ending line number (1-indexed, inclusive). if not provided, reads to end",
    ),
  lineStart: z
    .number()
    .optional()
    .describe(
      "optional starting line number (1-indexed). if not provided, reads from start",
    ),
})

export const createReadFileTool = (codebasePaths: string[]) => ({
  description: `read the contents of a code file.

parameters:
- filePath (required): path to file (absolute or relative to codebase paths)
- lineStart (optional): starting line number (1-indexed). if omitted, reads from start
- lineEnd (optional): ending line number (1-indexed, inclusive). if omitted, reads to end

use this to read specific files after finding them with code_search or find_components. you can read the entire file or a specific line range.

examples:
- read full file: filePath: 'packages/db/schema.prisma'
- read lines 1-50: filePath: 'packages/db/schema.prisma', lineStart: 1, lineEnd: 50
- read from line 100 to end: filePath: 'packages/db/schema.prisma', lineStart: 100`,
  execute:
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps path resolution and slicing together
    async function executeReadFile({
      filePath,
      lineStart,
      lineEnd,
    }: z.infer<typeof inputSchema>) {
      logTool("read_file", { filePath, lineEnd, lineStart })
      const start = performance.now()

      // resolve file path
      let resolvedPath: string | null = null

      if (isAbsolute(filePath)) {
        // check if absolute path exists using bun file api
        const file = Bun.file(filePath)
        if (await file.exists()) {
          resolvedPath = filePath
        }
      } else {
        // try relative to each codebase path
        for (const codebasePath of codebasePaths) {
          const candidate = resolve(codebasePath, filePath)
          const file = Bun.file(candidate)
          if (await file.exists()) {
            resolvedPath = candidate
            break
          }
        }
      }

      if (!resolvedPath) {
        const error = `file not found: ${filePath}`
        logError(error)
        return {
          error,
          filePath,
          found: false,
        }
      }

      try {
        const file = Bun.file(resolvedPath)
        const fullContent = await file.text()
        const lines = fullContent.split("\n")

        // handle line range
        const startIdx = lineStart ? Math.max(0, lineStart - 1) : 0
        const endIdx = lineEnd ? Math.min(lines.length, lineEnd) : lines.length

        if (startIdx >= endIdx || startIdx >= lines.length) {
          const error = `invalid line range: ${lineStart ?? 1}-${lineEnd ?? lines.length} (file has ${lines.length} lines)`
          logError(error)
          return {
            error,
            filePath: resolvedPath,
            found: true,
            totalLines: lines.length,
          }
        }

        const selectedLines = lines.slice(startIdx, endIdx)
        const content = selectedLines.join("\n")

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
          content,
          filePath: displayPath,
          found: true,
          lineEnd: endIdx,
          lineStart: startIdx + 1,
          totalLines: lines.length,
        }

        logToolResult(result, performance.now() - start)
        return result
      } catch (error) {
        const errorMsg = `failed to read file: ${resolvedPath}`
        logError(errorMsg, error)
        return {
          error: errorMsg,
          filePath: resolvedPath,
          found: true,
        }
      }
    },
  inputSchema,
})
