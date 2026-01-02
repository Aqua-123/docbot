import { unlink } from "node:fs/promises"
import { join } from "node:path"
import type { QdrantClient } from "@qdrant/qdrant-js"
import { z } from "zod"
import { deleteDocChunks } from "../../db/qdrant"
import type { DocIndex } from "../../index/doc-index"
import { parseMdx } from "../../mdx/parser"
import { deleteSection as deleteSectionFromDoc } from "../../mdx/writer"

const deleteSectionInputSchema = z.object({
  path: z.string().describe("path to the doc file relative to docs root"),
  section: z.string().describe("section id or heading to delete"),
})

export const createDeleteSectionTool = (
  docsPath: string,
  docIndex: DocIndex,
) => ({
  description: "delete a section from a documentation file",
  execute: async ({
    path,
    section,
  }: z.infer<typeof deleteSectionInputSchema>) => {
    const fullPath = join(docsPath, path)

    try {
      const fileContent = await Bun.file(fullPath).text()
      const doc = parseMdx(path, fileContent)

      const updatedContent = deleteSectionFromDoc(doc, section)

      await Bun.write(fullPath, updatedContent)

      // re-index the file
      await docIndex.indexFile(fullPath)

      return {
        message: `deleted section "${section}" from ${path}`,
        path,
        section,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: deleteSectionInputSchema,
})

const deleteDocInputSchema = z.object({
  confirm: z.boolean().describe("must be true to confirm deletion"),
  path: z.string().describe("path to the doc file relative to docs root"),
})

export const createDeleteDocTool = (
  docsPath: string,
  qdrantClient: QdrantClient,
) => ({
  description: "delete an entire documentation file (use with caution)",
  execute: async ({ path, confirm }: z.infer<typeof deleteDocInputSchema>) => {
    if (!confirm) {
      return {
        error: "deletion not confirmed - set confirm: true to proceed",
        success: false,
      }
    }

    const fullPath = join(docsPath, path)

    try {
      // delete the file
      await unlink(fullPath)

      // remove from index
      await deleteDocChunks(qdrantClient, path)

      return {
        message: `deleted doc at ${path}`,
        path,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: deleteDocInputSchema,
})
