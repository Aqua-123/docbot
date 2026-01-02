import { stringify as stringifyYaml } from "yaml"
import type { MdxDocument } from "../types"

/**
 * update a specific section's content in a document
 */
export function updateSection(
  doc: MdxDocument,
  sectionId: string,
  newContent: string,
): string {
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) {
    throw new Error(`section not found: ${sectionId}`)
  }

  const lines = doc.rawContent.split("\n")

  // find the heading line (the one right before the content starts)
  const headingLine = lines[section.startLine - 1]

  // replace the section content (keep the heading)
  const before = lines.slice(0, section.startLine - 1)
  const after = lines.slice(section.endLine)

  // format the new content with proper heading
  const updatedSection = [headingLine, "", newContent.trim()]

  return [...before, ...updatedSection, "", ...after].join("\n")
}

/**
 * insert a new section after a specified section
 */
export function insertSectionAfter(
  doc: MdxDocument,
  afterSectionId: string,
  heading: string,
  level: number,
  content: string,
): string {
  const afterSection = doc.sections.find((s) => s.id === afterSectionId)
  if (!afterSection) {
    throw new Error(`section not found: ${afterSectionId}`)
  }

  const lines = doc.rawContent.split("\n")
  const insertIndex = afterSection.endLine

  const headingPrefix = "#".repeat(level)
  const newSection = [`${headingPrefix} ${heading}`, "", content.trim(), ""]

  const before = lines.slice(0, insertIndex)
  const after = lines.slice(insertIndex)

  return [...before, "", ...newSection, ...after].join("\n")
}

/**
 * insert a new section at the end of the document
 */
export function appendSection(
  doc: MdxDocument,
  heading: string,
  level: number,
  content: string,
): string {
  const headingPrefix = "#".repeat(level)
  const newSection = [`${headingPrefix} ${heading}`, "", content.trim()]

  return [doc.rawContent.trimEnd(), "", ...newSection].join("\n")
}

/**
 * delete a section from the document
 */
export function deleteSection(doc: MdxDocument, sectionId: string): string {
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) {
    throw new Error(`section not found: ${sectionId}`)
  }

  const lines = doc.rawContent.split("\n")

  // remove lines from start of heading to end of section
  const before = lines.slice(0, section.startLine - 1)
  const after = lines.slice(section.endLine)

  return [...before, ...after].join("\n")
}

/**
 * move a section to a new location in the document
 */
export function moveSection(
  doc: MdxDocument,
  sectionId: string,
  afterSectionId: string | null,
): string {
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) {
    throw new Error(`section not found: ${sectionId}`)
  }

  const lines = doc.rawContent.split("\n")

  // extract the section content
  const sectionLines = lines.slice(section.startLine - 1, section.endLine)

  // remove from original location
  const withoutSection = [
    ...lines.slice(0, section.startLine - 1),
    ...lines.slice(section.endLine),
  ]

  // find insertion point
  let insertIndex: number
  if (afterSectionId === null) {
    // insert at the beginning (after frontmatter)
    const firstSection = doc.sections[0]
    insertIndex = firstSection ? firstSection.startLine - 1 : 0
  } else {
    const afterSection = doc.sections.find((s) => s.id === afterSectionId)
    if (!afterSection) {
      throw new Error(`section not found: ${afterSectionId}`)
    }

    // adjust index if the section was before the insertion point
    const sectionWasBefore = section.startLine < afterSection.startLine
    const adjustment = sectionWasBefore
      ? section.endLine - section.startLine + 1
      : 0
    insertIndex = afterSection.endLine - adjustment
  }

  // insert at new location
  const before = withoutSection.slice(0, insertIndex)
  const after = withoutSection.slice(insertIndex)

  return [...before, "", ...sectionLines, ...after].join("\n")
}

/**
 * create a new mdx document with frontmatter
 */
export function createDocument(
  frontmatter: Record<string, unknown>,
  sections: Array<{ heading: string; level: number; content: string }>,
): string {
  const parts: string[] = []

  // frontmatter
  if (Object.keys(frontmatter).length > 0) {
    parts.push("---")
    parts.push(stringifyYaml(frontmatter).trim())
    parts.push("---")
    parts.push("")
  }

  // sections
  for (const section of sections) {
    const headingPrefix = "#".repeat(section.level)
    parts.push(`${headingPrefix} ${section.heading}`)
    parts.push("")
    parts.push(section.content.trim())
    parts.push("")
  }

  return parts.join("\n")
}
