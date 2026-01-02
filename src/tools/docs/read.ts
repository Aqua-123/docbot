import { join } from "node:path"
import { z } from "zod"
import { logTool, logToolResult } from "../../logger"
import { parseMdx } from "../../mdx/parser"
import { buildOutline, findSection } from "../../mdx/sections"

const readDocInputSchema = z.object({
  path: z.string().describe("path to the doc file relative to docs root"),
  section: z
    .string()
    .optional()
    .describe("optional section id or heading to read"),
})

export const createReadDocTool = (docsPath: string) => ({
  description:
    "read the contents of a documentation file or a specific section",
  execute: async ({ path, section }: z.infer<typeof readDocInputSchema>) => {
    logTool("read_doc", { path, section })
    const start = performance.now()

    const fullPath = join(docsPath, path)

    try {
      const content = await Bun.file(fullPath).text()
      const doc = parseMdx(path, content)

      if (section) {
        const found = findSection(doc, section)
        if (!found) {
          logToolResult(
            { error: "section not found" },
            performance.now() - start,
          )
          return { error: `section not found: ${section}` }
        }
        const result = {
          content: found.content,
          level: found.level,
          path,
          section: found.heading,
        }
        logToolResult(
          { chars: found.content.length },
          performance.now() - start,
        )
        return result
      }

      logToolResult(
        { chars: doc.rawContent.length, sections: doc.sections.length },
        performance.now() - start,
      )
      return {
        content: doc.rawContent,
        frontmatter: doc.frontmatter,
        outline: buildOutline(doc),
        path,
      }
    } catch {
      logToolResult({ error: "failed to read" }, performance.now() - start)
      return { error: `failed to read file: ${path}` }
    }
  },
  inputSchema: readDocInputSchema,
})

const outlineInputSchema = z.object({
  path: z.string().describe("path to the doc file relative to docs root"),
})

export const createGetOutlineTool = (docsPath: string) => ({
  description: "get the hierarchical outline of a documentation file",
  execute: async ({ path }: z.infer<typeof outlineInputSchema>) => {
    logTool("get_doc_outline", { path })
    const start = performance.now()

    const fullPath = join(docsPath, path)

    try {
      const content = await Bun.file(fullPath).text()
      const doc = parseMdx(path, content)

      const result = {
        frontmatter: doc.frontmatter,
        outline: buildOutline(doc),
        path,
        sectionCount: doc.sections.length,
      }
      logToolResult(
        { sections: doc.sections.length },
        performance.now() - start,
      )
      return result
    } catch {
      logToolResult({ error: "failed to read" }, performance.now() - start)
      return { error: `failed to read file: ${path}` }
    }
  },
  inputSchema: outlineInputSchema,
})
