import { join } from "node:path"
import { z } from "zod"
import type { DocIndex } from "../../index/doc-index"
import { parseMdx } from "../../mdx/parser"
import { updateSection } from "../../mdx/writer"

const updateInputSchema = z.object({
  content: z.string().describe("new content for the section"),
  path: z.string().describe("path to the doc file relative to docs root"),
  section: z.string().describe("section id or heading to update"),
})

export const createUpdateSectionTool = (
  docsPath: string,
  docIndex: DocIndex,
) => ({
  description:
    "update the content of a specific section in a documentation file",
  execute: async ({
    path,
    section,
    content,
  }: z.infer<typeof updateInputSchema>) => {
    const fullPath = join(docsPath, path)

    try {
      const fileContent = await Bun.file(fullPath).text()
      const doc = parseMdx(path, fileContent)

      const updatedContent = updateSection(doc, section, content)

      await Bun.write(fullPath, updatedContent)

      // re-index the file
      await docIndex.indexFile(fullPath)

      return {
        message: `updated section "${section}" in ${path}`,
        path,
        section,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: updateInputSchema,
})
