import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import type { DocIndex } from "../../index/doc-index"
import { parseMdx } from "../../mdx/parser"
import {
  appendSection,
  createDocument,
  insertSectionAfter,
} from "../../mdx/writer"
import { createRegisterNavTool } from "./register-nav"

const createDocInputSchema = z.object({
  description: z.string().describe("brief description of the document"),
  navGroup: z
    .string()
    .optional()
    .describe("navigation group in docs.json to add this page to"),
  path: z.string().describe("path for the new doc file relative to docs root"),
  sections: z
    .array(
      z.object({
        content: z.string(),
        heading: z.string(),
        level: z.number().min(1).max(6).default(2),
      }),
    )
    .describe("sections to include in the document"),
  title: z.string().describe("title for the document"),
})

export const createDocTool = (docsPath: string, docIndex: DocIndex) => ({
  description:
    "create a new documentation file with frontmatter and sections. " +
    "automatically registers the page in docs.json navigation.",
  execute: async ({
    path,
    title,
    description,
    sections,
    navGroup,
  }: z.infer<typeof createDocInputSchema>) => {
    const fullPath = join(docsPath, path)

    try {
      // ensure directory exists
      await mkdir(dirname(fullPath), { recursive: true })

      // create the document
      const content = createDocument({ description, title }, sections)

      await Bun.write(fullPath, content)

      // index the new file
      await docIndex.indexFile(fullPath)

      // auto-register in navigation
      const registerNav = createRegisterNavTool(docsPath)
      const navResult = await registerNav.execute({
        docPath: path,
        group: navGroup,
        position: "end",
        title,
      })

      return {
        message: `created new doc at ${path}`,
        navigation: navResult,
        path,
        sectionCount: sections.length,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: createDocInputSchema,
})

const addSectionInputSchema = z.object({
  afterSection: z
    .string()
    .optional()
    .describe(
      "insert after this section (id or heading). if omitted, appends to end",
    ),
  content: z.string().describe("content for the new section"),
  heading: z.string().describe("heading for the new section"),
  level: z.number().min(1).max(6).default(2).describe("heading level (1-6)"),
  path: z.string().describe("path to the doc file relative to docs root"),
})

export const createAddSectionTool = (docsPath: string, docIndex: DocIndex) => ({
  description: "add a new section to an existing documentation file",
  execute: async ({
    path,
    heading,
    level,
    content,
    afterSection,
  }: z.infer<typeof addSectionInputSchema>) => {
    const fullPath = join(docsPath, path)

    try {
      const fileContent = await Bun.file(fullPath).text()
      const doc = parseMdx(path, fileContent)

      let updatedContent: string

      if (afterSection) {
        updatedContent = insertSectionAfter(
          doc,
          afterSection,
          heading,
          level,
          content,
        )
      } else {
        updatedContent = appendSection(doc, heading, level, content)
      }

      await Bun.write(fullPath, updatedContent)

      // re-index the file
      await docIndex.indexFile(fullPath)

      return {
        message: `added section "${heading}" to ${path}`,
        path,
        section: heading,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: addSectionInputSchema,
})
