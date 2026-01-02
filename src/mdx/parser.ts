import type { Heading, Root, RootContent } from "mdast"
import remarkFrontmatter from "remark-frontmatter"
import remarkMdx from "remark-mdx"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { parse as parseYaml } from "yaml"
import type { MdxDocument, MdxSection } from "../types"
import { generateSectionId } from "./sections"

/**
 * parse an mdx file into a structured document
 */
export function parseMdx(path: string, content: string): MdxDocument {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkFrontmatter, ["yaml"])

  const tree = processor.parse(content) as Root
  const lines = content.split("\n")

  // extract frontmatter
  const frontmatter = extractFrontmatter(tree)

  // extract sections
  const sections = extractSections(tree, lines)

  return {
    frontmatter,
    path,
    rawContent: content,
    sections,
  }
}

/**
 * extract yaml frontmatter from the ast
 */
function extractFrontmatter(tree: Root): Record<string, unknown> {
  const yamlNode = tree.children.find((node) => node.type === "yaml")

  if (!(yamlNode && "value" in yamlNode)) {
    return {}
  }

  try {
    return parseYaml(yamlNode.value as string) ?? {}
  } catch {
    return {}
  }
}

/**
 * extract sections from the ast based on headings
 */
function extractSections(tree: Root, lines: string[]): MdxSection[] {
  const sections: MdxSection[] = []
  const headingNodes: Array<{ node: Heading; index: number }> = []

  // find all heading nodes with their indices
  tree.children.forEach((node, index) => {
    if (node.type === "heading") {
      headingNodes.push({ index, node: node as Heading })
    }
  })

  // create sections from headings
  headingNodes.forEach(({ node, index }, i) => {
    const headingText = extractTextFromNode(node)
    const startLine = node.position?.start.line ?? 1

    // end line is either the next heading's start or the end of file
    const nextHeading = headingNodes[i + 1]
    const endLine = nextHeading
      ? (tree.children[nextHeading.index]?.position?.start.line ??
          lines.length) - 1
      : lines.length

    // extract content between this heading and the next
    const contentNodes = tree.children.slice(
      index + 1,
      nextHeading ? nextHeading.index : undefined,
    )
    const sectionContent = contentNodes
      .map((n) => extractTextFromNode(n))
      .filter(Boolean)
      .join("\n\n")

    sections.push({
      content: sectionContent,
      endLine,
      heading: headingText,
      id: generateSectionId(headingText),
      level: node.depth,
      startLine,
    })
  })

  return sections
}

/**
 * recursively extract text from an ast node
 */
function extractTextFromNode(node: RootContent | Heading): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value
  }

  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => extractTextFromNode(child as RootContent))
      .join("")
  }

  return ""
}
