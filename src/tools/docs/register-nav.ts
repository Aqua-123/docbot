import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { z } from "zod"

const CONTENT_PREFIX_REGEX = /^content\/docs\//
const MDX_EXTENSION_REGEX = /\.mdx$/

const registerNavInputSchema = z.object({
  docPath: z
    .string()
    .describe("path to the new doc file relative to docs root"),
  group: z
    .string()
    .optional()
    .describe(
      "navigation group to add to (e.g. 'Getting Started', 'Features')",
    ),
  position: z
    .enum(["start", "end"])
    .optional()
    .default("end")
    .describe("where to add within the group"),
  title: z.string().describe("title to display in navigation"),
})

type NavItem =
  | string
  | {
      group: string
      pages: NavItem[]
      icon?: string
      expanded?: boolean
      tag?: string
    }

interface DocsJson {
  navigation?: {
    groups?: NavItem[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * find the docs.json file by walking up from the docs path
 */
async function findDocsJson(docsPath: string): Promise<string | null> {
  let current = docsPath
  const root = dirname(current)

  while (current !== root) {
    const candidate = join(current, "docs.json")
    try {
      await readFile(candidate, "utf-8")
      return candidate
    } catch {
      // not found, keep looking
    }
    current = dirname(current)
  }

  return null
}

/**
 * convert a doc file path to a navigation path
 * e.g. "content/docs/features/notifications.mdx" -> "features/notifications"
 */
function toNavPath(docPath: string, docsRoot: string): string {
  const rel = relative(docsRoot, docPath)
  // remove content/docs prefix if present, and .mdx extension
  return rel.replace(CONTENT_PREFIX_REGEX, "").replace(MDX_EXTENSION_REGEX, "")
}

/**
 * add a page to a navigation array, optionally in a specific group
 */
function addToNavigation(
  nav: NavItem[],
  navPath: string,
  group?: string,
  position: "start" | "end" = "end",
): NavItem[] {
  // if no group specified, add to top level
  if (!group) {
    if (position === "start") {
      return [navPath, ...nav]
    }
    return [...nav, navPath]
  }

  // find the group
  const groupIndex = nav.findIndex(
    (item) => typeof item === "object" && item.group === group,
  )

  if (groupIndex === -1) {
    // group doesn't exist, create it
    const newGroup = { group, pages: [navPath] }
    if (position === "start") {
      return [newGroup, ...nav]
    }
    return [...nav, newGroup]
  }

  // add to existing group
  const existingGroup = nav[groupIndex] as { group: string; pages: NavItem[] }
  const updatedPages =
    position === "start"
      ? [navPath, ...existingGroup.pages]
      : [...existingGroup.pages, navPath]

  return [
    ...nav.slice(0, groupIndex),
    { ...existingGroup, pages: updatedPages },
    ...nav.slice(groupIndex + 1),
  ]
}

/**
 * create the register_nav tool for adding pages to docs.json navigation
 */
export const createRegisterNavTool = (docsPath: string) => ({
  description:
    "register a new documentation page in the docs.json navigation config. " +
    "call this after creating a new doc to make it appear in the sidebar.",
  execute: async ({
    docPath,
    group,
    position,
  }: z.infer<typeof registerNavInputSchema>) => {
    try {
      const docsJsonPath = await findDocsJson(docsPath)

      if (!docsJsonPath) {
        return {
          error: "could not find docs.json in docs directory tree",
          success: false,
        }
      }

      const content = await readFile(docsJsonPath, "utf-8")
      const docsJson: DocsJson = JSON.parse(content)

      if (!docsJson.navigation) {
        docsJson.navigation = {}
      }
      if (!docsJson.navigation.groups) {
        docsJson.navigation.groups = []
      }

      const navPath = toNavPath(join(docsPath, docPath), dirname(docsJsonPath))

      // check if already registered
      const exists = JSON.stringify(docsJson.navigation.groups).includes(
        `"${navPath}"`,
      )
      if (exists) {
        return {
          alreadyExists: true,
          message: `${navPath} is already in navigation`,
          success: true,
        }
      }

      docsJson.navigation.groups = addToNavigation(
        docsJson.navigation.groups,
        navPath,
        group,
        position,
      )

      await writeFile(docsJsonPath, `${JSON.stringify(docsJson, null, 2)}\n`)

      return {
        docsJsonPath,
        message: `added ${navPath} to navigation${group ? ` in group "${group}"` : ""}`,
        navPath,
        success: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: registerNavInputSchema,
})
