import { $ } from "bun"
import { z } from "zod"
import { logCmd, logError, logTool, logToolResult } from "../../logger"

const inputSchema = z.object({
  fileType: z
    .string()
    .optional()
    .describe(
      "file extension without dot to filter results (e.g. 'ts', 'tsx', 'js', 'prisma')",
    ),
  maxResults: z
    .union([z.number(), z.string().transform((val) => Number(val))])
    .default(10)
    .describe(
      "maximum number of results to return (number type, not a string)",
    ),
  query: z
    .string()
    .describe(
      "exact text or regex pattern to search for. use identifiers, type names, function names, or simple regex. examples: 'ActivityEntry', 'parentId', 'Comment.*Thread', 'function.*create'. avoid semantic queries like 'activity history model' - use exact code terms instead.",
    ),
})

export const createCodeSearchTool = (codebasePaths: string[]) => ({
  description: `search the codebase for exact code patterns using ripgrep (text/regex search, not semantic).

CRITICAL - how to write effective queries:
- ✅ USE: exact identifiers, type names, function names, variable names (e.g. 'ActivityEntry', 'parentId', 'CommentThread', 'createComment')
- ✅ USE: simple regex patterns for variations (e.g. 'Comment.*Thread', 'function.*create', 'model.*Activity')
- ❌ AVOID: semantic/natural language queries (e.g. 'activity history model', 'comment thread reply', 'audit log entry')
- ❌ AVOID: multi-word phrases unless they appear exactly in code (e.g. 'activity history' won't match 'ActivityHistory')

ripgrep searches for literal text/regex matches in source code. if you need to understand what a feature does:
1. first search for component/type names you found (e.g. 'CommentThread', 'ActivityEntry')
2. then search for related identifiers from the results (e.g. 'parentId', 'resolved', 'action')
3. use find_components to discover component names if you don't know them

parameters:
- query (required): exact text/regex pattern (identifiers, type names, function names). examples: 'ActivityEntry', 'parentId', 'Comment.*Thread'
- fileType (optional): filter by extension without dot (e.g. 'ts', 'tsx', 'prisma', 'tsx')
- maxResults (optional, default: 10): max results (number)

note: after finding files with 'code_search', use 'read_file' to read the full file contents or specific line ranges. you can also use 'list_directory' to explore the directory structure and find related files.

for conceptual or natural language queries (e.g. 'where do we handle authentication', 'error handling middleware'), use 'semantic_code_search' instead; it searches embeddings of the codebase.`,
  execute:
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps search handling together
    async function executeCodeSearch({
      query,
      fileType,
      maxResults: maxResultsRaw,
    }: z.infer<typeof inputSchema>) {
      // ensure maxResults is a number (union type may pass string)
      const maxResults =
        typeof maxResultsRaw === "number"
          ? maxResultsRaw
          : Number(maxResultsRaw) || 10

      logTool("code_search", { fileType, maxResults, query })
      const start = performance.now()

      const allMatches: Array<{
        path: string
        line: number
        content: string
      }> = []

      for (const codebasePath of codebasePaths) {
        try {
          // build args array for proper shell escaping
          const args = [
            "--json",
            "--max-count",
            String(maxResults * 2),
            "--smart-case",
          ]
          if (fileType) {
            args.push("--type", fileType)
          }
          args.push(query, codebasePath)

          const cmd = `rg ${args.join(" ")}`
          logCmd(cmd)

          const result = await $`rg ${args}`.quiet()

          const lines = result.stdout
            .toString()
            .trim()
            .split("\n")
            .filter(Boolean)

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              if (parsed.type !== "match") continue

              allMatches.push({
                content: (parsed.data?.lines?.text ?? "").trim(),
                line: parsed.data?.line_number ?? 0,
                path: parsed.data?.path?.text ?? "",
              })

              if (allMatches.length >= maxResults) break
            } catch {
              // skip malformed json
            }
          }
        } catch (error) {
          // ripgrep returns non-zero when no matches found
          if (
            !(error instanceof Error && error.message.includes("exit code"))
          ) {
            logError(`ripgrep failed for ${codebasePath}`, error)
          }
        }

        if (allMatches.length >= maxResults) break
      }

      const result = {
        matches: allMatches.slice(0, maxResults),
        total: allMatches.length,
      }
      logToolResult(result, performance.now() - start)
      return result
    },
  inputSchema,
})
