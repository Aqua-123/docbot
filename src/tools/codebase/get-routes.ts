import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { z } from "zod"
import { logInfo, logTool, logToolResult } from "../../logger"

const FILE_EXTENSION_PATTERN = /\.(tsx?|jsx?)$/

const inputSchema = z.object({
  appDirectory: z
    .string()
    .default("app")
    .describe("the app directory to scan (default: 'app')"),
  includeApi: z.boolean().default(true).describe("include api routes"),
})

export const createGetRoutesTool = (codebasePaths: string[]) => ({
  description: `find all page routes in a next.js or similar app.

parameters:
- appDirectory (optional, default: 'app'): the app directory to scan
- includeApi (optional, default: true): whether to include api routes

returns routes with their paths, types (page/api/layout/loading/error), and file paths.`,
  execute: async ({
    appDirectory,
    includeApi,
  }: z.infer<typeof inputSchema>) => {
    logTool("get_routes", { appDirectory, includeApi })
    const start = performance.now()

    const routes: Array<{
      path: string
      type: "page" | "api" | "layout" | "loading" | "error"
      filePath: string
    }> = []

    for (const codebasePath of codebasePaths) {
      const appPath = join(codebasePath, appDirectory)
      logInfo(`scanning ${appPath}`)

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps recursive route scan readable
      async function scanDir(dir: string, routePath: string) {
        try {
          const entries = await readdir(dir, { withFileTypes: true })

          for (const entry of entries) {
            const fullPath = join(dir, entry.name)

            if (entry.isDirectory()) {
              // skip node_modules and hidden dirs
              if (entry.name.startsWith(".") || entry.name === "node_modules") {
                continue
              }

              // skip api routes if not requested
              if (entry.name === "api" && !includeApi) {
                continue
              }

              // handle dynamic routes
              let segment = entry.name
              if (segment.startsWith("[") && segment.endsWith("]")) {
                segment = `:${segment.slice(1, -1)}`
              }

              await scanDir(fullPath, `${routePath}/${segment}`)
            } else {
              // check for route files
              const routeType = getRouteType(entry.name)
              if (routeType) {
                routes.push({
                  filePath: relative(codebasePath, fullPath),
                  path: routePath || "/",
                  type: routeType,
                })
              }
            }
          }
        } catch {
          // directory doesn't exist or can't be read
        }
      }

      await scanDir(appPath, "")
    }

    const result = {
      apiRoutes: routes.filter((r) => r.type === "api").length,
      pages: routes.filter((r) => r.type === "page").length,
      routes,
      total: routes.length,
    }

    logToolResult(result, performance.now() - start)
    return result
  },
  inputSchema,
})

function getRouteType(
  filename: string,
): "page" | "api" | "layout" | "loading" | "error" | null {
  const name = filename.replace(FILE_EXTENSION_PATTERN, "")

  switch (name) {
    case "page":
      return "page"
    case "route":
      return "api"
    case "layout":
      return "layout"
    case "loading":
      return "loading"
    case "error":
      return "error"
    default:
      return null
  }
}
