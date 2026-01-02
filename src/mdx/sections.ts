import type { MdxDocument, MdxSection } from "../types"

/**
 * generate a url-safe section id from heading text
 */
export function generateSectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * find a section by id or heading text
 */
export function findSection(
  doc: MdxDocument,
  query: string,
): MdxSection | null {
  const normalized = query.toLowerCase()

  // try exact id match first
  const byId = doc.sections.find((s) => s.id === query)
  if (byId) return byId

  // try heading match
  const byHeading = doc.sections.find(
    (s) => s.heading.toLowerCase() === normalized,
  )
  if (byHeading) return byHeading

  // try partial match
  const partial = doc.sections.find(
    (s) =>
      s.id.includes(normalized) || s.heading.toLowerCase().includes(normalized),
  )
  return partial ?? null
}

/**
 * build a hierarchical outline of the document
 */
export function buildOutline(doc: MdxDocument): OutlineNode[] {
  const outline: OutlineNode[] = []
  const stack: Array<{ node: OutlineNode; level: number }> = []

  for (const section of doc.sections) {
    const node: OutlineNode = {
      children: [],
      heading: section.heading,
      id: section.id,
      level: section.level,
    }

    // find the right parent
    while (stack.length > 0 && stack.at(-1)!.level >= section.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      outline.push(node)
    } else {
      stack.at(-1)!.node.children.push(node)
    }

    stack.push({ level: section.level, node })
  }

  return outline
}

export interface OutlineNode {
  id: string
  heading: string
  level: number
  children: OutlineNode[]
}
