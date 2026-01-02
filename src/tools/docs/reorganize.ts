import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { QdrantClient } from "@qdrant/qdrant-js"
import { z } from "zod"
import { deleteDocChunks } from "../../db/qdrant"
import type { DocIndex } from "../../index/doc-index"
import { parseMdx } from "../../mdx/parser"
import { createDocument } from "../../mdx/writer"

const MDX_EXTENSION_REGEX = /\.mdx?$/

const renameDocInputSchema = z.object({
  newPath: z.string().describe("new path relative to docs root"),
  oldPath: z.string().describe("current path relative to docs root"),
})

export const createRenameDocTool = (
  docsPath: string,
  docIndex: DocIndex,
  qdrantClient: QdrantClient,
) => ({
  description: "rename or move a documentation file to a new path",
  execute: async ({
    oldPath,
    newPath,
  }: z.infer<typeof renameDocInputSchema>) => {
    const oldFullPath = join(docsPath, oldPath)
    const newFullPath = join(docsPath, newPath)

    try {
      // ensure target directory exists
      await mkdir(dirname(newFullPath), { recursive: true })

      // move the file
      await rename(oldFullPath, newFullPath)

      // remove old index entries
      await deleteDocChunks(qdrantClient, oldPath)

      // index at new location
      await docIndex.indexFile(newFullPath)

      return {
        message: `moved ${oldPath} to ${newPath}`,
        newPath,
        oldPath,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: renameDocInputSchema,
})

const consolidateInputSchema = z.object({
  description: z.string().describe("description for the consolidated doc"),
  sourcePaths: z
    .array(z.string())
    .min(2)
    .describe("paths of docs to consolidate"),
  targetPath: z.string().describe("path for the consolidated doc"),
  title: z.string().describe("title for the consolidated doc"),
})

export const createConsolidateDocsTool = (
  docsPath: string,
  docIndex: DocIndex,
) => ({
  description:
    "consolidate multiple related documentation files into one, preserving all content",
  execute: async ({
    sourcePaths,
    targetPath,
    title,
    description,
  }: z.infer<typeof consolidateInputSchema>) => {
    try {
      // read all source docs
      const allSections: Array<{
        heading: string
        level: number
        content: string
      }> = []

      for (const sourcePath of sourcePaths) {
        const fullPath = join(docsPath, sourcePath)
        const content = await Bun.file(fullPath).text()
        const doc = parseMdx(sourcePath, content)

        // add a header for each source doc
        const sourceTitle =
          (doc.frontmatter.title as string) ||
          sourcePath.replace(MDX_EXTENSION_REGEX, "")
        allSections.push({
          content: "",
          heading: sourceTitle,
          level: 2,
        })

        // add all sections from this doc (bump levels by 1)
        for (const section of doc.sections) {
          allSections.push({
            content: section.content,
            heading: section.heading,
            level: Math.min(section.level + 1, 6),
          })
        }
      }

      // create the consolidated doc
      const consolidatedContent = createDocument(
        { description, title },
        allSections,
      )

      const targetFullPath = join(docsPath, targetPath)
      await mkdir(dirname(targetFullPath), { recursive: true })
      await Bun.write(targetFullPath, consolidatedContent)

      // index the new file
      await docIndex.indexFile(targetFullPath)

      return {
        message: `consolidated ${sourcePaths.length} docs into ${targetPath}`,
        note: "original files have NOT been deleted - review and delete manually if satisfied",
        sourcePaths,
        success: true,
        targetPath,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: consolidateInputSchema,
})
