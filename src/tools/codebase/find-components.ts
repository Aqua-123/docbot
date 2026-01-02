import { $ } from "bun"
import { z } from "zod"
import { logCmd, logError, logTool, logToolResult } from "../../logger"

// patterns for finding react components
const COMPONENT_PATTERNS = {
  arrowComponent: /export\s+(?:const|let)\s+([A-Z][a-zA-Z0-9]*)\s*[=:]/g,
  functionComponent: /export\s+(?:default\s+)?function\s+([A-Z][a-zA-Z0-9]*)/g,
}

const inputSchema = z.object({
  directory: z.string().optional().describe("subdirectory to search within"),
  namePattern: z
    .string()
    .optional()
    .describe("regex pattern to match component names"),
})

export const createFindComponentsTool = (codebasePaths: string[]) => ({
  description: `find react components in the codebase matching a pattern.

parameters:
- namePattern (optional): regex pattern to match component names (e.g. 'Button', '.*Form')
- directory (optional): subdirectory to search within (e.g. 'components', 'features')

searches for function components and arrow function components in .tsx and .jsx files.`,
  execute: async ({ namePattern, directory }: z.infer<typeof inputSchema>) => {
    logTool("find_components", { directory, namePattern })
    const start = performance.now()

    const nameRegex = namePattern ? new RegExp(namePattern, "i") : null

    const results = await Promise.all(
      codebasePaths.map((codebasePath) =>
        findComponentsInPath(codebasePath, directory, nameRegex),
      ),
    )

    const components = results.flat()
    const result = { components, total: components.length }
    logToolResult(result, performance.now() - start)
    return result
  },
  inputSchema,
})

async function findComponentsInPath(
  codebasePath: string,
  directory: string | undefined,
  nameRegex: RegExp | null,
) {
  try {
    const searchPath = directory ? `${codebasePath}/${directory}` : codebasePath
    const files = await listComponentFiles(searchPath)
    const components = await Promise.all(
      files.map((filePath) => collectComponents(filePath, nameRegex)),
    )
    return components.flat()
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("exit code"))) {
      logError(`find_components failed for ${codebasePath}`, error)
    }
    return []
  }
}

async function listComponentFiles(searchPath: string) {
  const args = ["--files", "--glob", "*.tsx", "--glob", "*.jsx", searchPath]
  logCmd(`rg ${args.join(" ")}`)
  const result = await $`rg ${args}`.quiet()
  return result.stdout.toString().trim().split("\n").filter(Boolean)
}

async function collectComponents(filePath: string, nameRegex: RegExp | null) {
  try {
    const content = await Bun.file(filePath).text()
    return [
      ...extractComponents(
        content,
        COMPONENT_PATTERNS.functionComponent,
        "function",
        nameRegex,
        filePath,
      ),
      ...extractComponents(
        content,
        COMPONENT_PATTERNS.arrowComponent,
        "arrow",
        nameRegex,
        filePath,
      ),
    ]
  } catch {
    return []
  }
}

function extractComponents(
  content: string,
  pattern: RegExp,
  type: "function" | "arrow",
  nameRegex: RegExp | null,
  filePath: string,
) {
  const matches: Array<{
    name: string
    path: string
    type: "function" | "arrow"
  }> = []
  for (const match of content.matchAll(pattern)) {
    const name = match[1]
    if (name && (!nameRegex || nameRegex.test(name))) {
      matches.push({ name, path: filePath, type })
    }
  }
  return matches
}
