import { join } from "node:path"
import { z } from "zod"
import type { DocIndex } from "../../index/doc-index"
import { parseMdx } from "../../mdx/parser"
import { findSection } from "../../mdx/sections"
import {
  appendSection,
  deleteSection,
  insertSectionAfter,
  moveSection,
} from "../../mdx/writer"

const moveSectionInputSchema = z.object({
  afterSection: z
    .string()
    .nullable()
    .describe("move after this section (null = move to beginning)"),
  path: z.string().describe("path to the doc file relative to docs root"),
  section: z.string().describe("section id or heading to move"),
})

export const createMoveSectionTool = (
  docsPath: string,
  docIndex: DocIndex,
) => ({
  description:
    "move a section to a different position within the same document",
  execute: async ({
    path,
    section,
    afterSection,
  }: z.infer<typeof moveSectionInputSchema>) => {
    const fullPath = join(docsPath, path)

    try {
      const fileContent = await Bun.file(fullPath).text()
      const doc = parseMdx(path, fileContent)

      const updatedContent = moveSection(doc, section, afterSection)

      await Bun.write(fullPath, updatedContent)

      // re-index the file
      await docIndex.indexFile(fullPath)

      return {
        message: `moved section "${section}" ${afterSection ? `after "${afterSection}"` : "to beginning"}`,
        path,
        section,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: moveSectionInputSchema,
})

const moveContentInputSchema = z.object({
  afterSection: z
    .string()
    .optional()
    .describe("insert after this section in target (omit to append)"),
  sourcePath: z.string().describe("source doc path relative to docs root"),
  sourceSection: z.string().describe("section to move from source"),
  targetPath: z.string().describe("target doc path relative to docs root"),
})

export const createMoveContentTool = (
  docsPath: string,
  docIndex: DocIndex,
) => ({
  description: "move content from one document to another",
  execute: async ({
    sourcePath,
    sourceSection,
    targetPath,
    afterSection,
  }: z.infer<typeof moveContentInputSchema>) => {
    const sourceFullPath = join(docsPath, sourcePath)
    const targetFullPath = join(docsPath, targetPath)

    try {
      // read source
      const sourceContent = await Bun.file(sourceFullPath).text()
      const sourceDoc = parseMdx(sourcePath, sourceContent)

      const section = findSection(sourceDoc, sourceSection)
      if (!section) {
        return { error: `section not found: ${sourceSection}`, success: false }
      }

      // read target
      const targetContent = await Bun.file(targetFullPath).text()
      const targetDoc = parseMdx(targetPath, targetContent)

      // add to target
      let updatedTarget: string
      if (afterSection) {
        updatedTarget = insertSectionAfter(
          targetDoc,
          afterSection,
          section.heading,
          section.level,
          section.content,
        )
      } else {
        updatedTarget = appendSection(
          targetDoc,
          section.heading,
          section.level,
          section.content,
        )
      }

      // remove from source
      const updatedSource = deleteSection(sourceDoc, sourceSection)

      // write both files
      await Bun.write(sourceFullPath, updatedSource)
      await Bun.write(targetFullPath, updatedTarget)

      // re-index both files
      await Promise.all([
        docIndex.indexFile(sourceFullPath),
        docIndex.indexFile(targetFullPath),
      ])

      return {
        message: `moved "${section.heading}" from ${sourcePath} to ${targetPath}`,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: moveContentInputSchema,
})
