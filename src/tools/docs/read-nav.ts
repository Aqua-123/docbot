import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

const readNavInputSchema = z.object({
  includeAllFields: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "include all docs.json fields (theme, colors, logo, etc.) not just navigation",
    ),
})

// types for navigation structure
type NavPage = string
type NavGroup = {
  group: string
  icon?: string
  tag?: string
  expanded?: boolean
  pages: NavItem[]
}
type NavItem = NavPage | NavGroup

interface NavTab {
  tab: string
  icon?: string
  groups?: NavItem[]
  menu?: Array<{
    item: string
    icon?: string
    description?: string
    groups?: NavItem[]
    pages?: NavPage[]
  }>
}

interface NavDropdown {
  dropdown: string
  icon?: string
  href?: string
  pages?: NavPage[]
}

interface NavAnchor {
  anchor: string
  href?: string
  icon?: string
  groups?: NavItem[]
}

interface NavigationConfig {
  groups?: NavItem[]
  tabs?: NavTab[]
  dropdowns?: NavDropdown[]
  anchors?: NavAnchor[]
  global?: {
    anchors?: NavAnchor[]
  }
}

interface DocsJson {
  name?: string
  description?: string
  theme?: string
  colors?: Record<string, string>
  logo?: Record<string, string>
  navigation?: NavigationConfig
  [key: string]: unknown
}

/**
 * find the docs.json file by walking up from the docs path
 */
function findDocsJson(docsPath: string): string | null {
  let current = docsPath
  const root = dirname(current)

  while (current !== root) {
    const candidate = join(current, "docs.json")
    if (existsSync(candidate)) {
      return candidate
    }
    current = dirname(current)
  }

  return null
}

/**
 * flatten navigation structure into a list of page paths with their group hierarchy
 */
function flattenNavigation(
  items: NavItem[],
  path: string[] = [],
): Array<{ page: string; groups: string[] }> {
  const result: Array<{ page: string; groups: string[] }> = []

  for (const item of items) {
    if (typeof item === "string") {
      result.push({ groups: path, page: item })
    } else {
      // it's a group
      const groupPath = [...path, item.group]
      result.push(...flattenNavigation(item.pages, groupPath))
    }
  }

  return result
}

/**
 * summarize navigation structure for AI consumption
 */
function summarizeNavigation(nav: NavigationConfig): {
  structure: string
  groups: string[]
  pages: Array<{ page: string; groups: string[] }>
  stats: { totalPages: number; totalGroups: number; maxDepth: number }
} {
  const allPages: Array<{ page: string; groups: string[] }> = []
  const allGroups = new Set<string>()
  let maxDepth = 0

  const processItems = (items: NavItem[], depth: number) => {
    for (const item of items) {
      if (typeof item === "string") {
        // it's a page
      } else {
        allGroups.add(item.group)
        maxDepth = Math.max(maxDepth, depth)
        processItems(item.pages, depth + 1)
      }
    }
  }

  // process main groups
  if (nav.groups) {
    const flattened = flattenNavigation(nav.groups)
    allPages.push(...flattened)
    processItems(nav.groups, 1)
  }

  // process tabs
  if (nav.tabs) {
    for (const tab of nav.tabs) {
      if (tab.groups) {
        const flattened = flattenNavigation(tab.groups, [`tab:${tab.tab}`])
        allPages.push(...flattened)
        processItems(tab.groups, 2)
      }
    }
  }

  // determine structure type
  let structure = "groups"
  if (nav.tabs && nav.tabs.length > 0) {
    structure = "tabs"
  }
  if (nav.dropdowns && nav.dropdowns.length > 0) {
    structure = "dropdowns"
  }
  if (nav.anchors && nav.anchors.length > 0) {
    structure = "anchors"
  }

  return {
    groups: Array.from(allGroups),
    pages: allPages,
    stats: {
      maxDepth,
      totalGroups: allGroups.size,
      totalPages: allPages.length,
    },
    structure,
  }
}

/**
 * create the read_nav tool for reading and analyzing docs.json navigation
 */
export const createReadNavTool = (docsPath: string) => ({
  description:
    "read and analyze the docs.json navigation structure. returns the navigation hierarchy, " +
    "list of all pages and their groups, and statistics. use this to understand the current " +
    "documentation structure before making changes.",
  execute: async ({ includeAllFields }: z.infer<typeof readNavInputSchema>) => {
    try {
      const docsJsonPath = await findDocsJson(docsPath)

      if (!docsJsonPath) {
        return {
          error: "could not find docs.json in docs directory tree",
          hint: "make sure your docs directory contains a docs.json file",
          success: false,
        }
      }

      const content = await readFile(docsJsonPath, "utf-8")
      const docsJson: DocsJson = JSON.parse(content)

      if (!docsJson.navigation) {
        return {
          docsJsonPath,
          message: "docs.json exists but has no navigation configuration",
          navigation: null,
          success: true,
        }
      }

      const summary = summarizeNavigation(docsJson.navigation)

      const result: Record<string, unknown> = {
        docsJsonPath,
        groups: summary.groups,
        pages: summary.pages,
        rawNavigation: docsJson.navigation,
        stats: summary.stats,
        structure: summary.structure,
        success: true,
      }

      if (includeAllFields) {
        result.name = docsJson.name
        result.description = docsJson.description
        result.theme = docsJson.theme
        result.colors = docsJson.colors
        result.logo = docsJson.logo
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: readNavInputSchema,
})
