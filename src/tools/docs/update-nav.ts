import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

// define nav item schema recursively
const navItemSchema: z.ZodType<string | NavGroup> = z.lazy(() =>
  z.union([
    z.string().describe("page path (relative to docs root)"),
    navGroupSchema,
  ]),
)

export interface NavGroup {
  group: string
  icon?: string
  tag?: string
  expanded?: boolean
  pages: Array<string | NavGroup>
}

const navGroupSchema: z.ZodType<NavGroup> = z.object({
  expanded: z
    .boolean()
    .optional()
    .describe("whether group is expanded by default"),
  group: z.string().describe("group display name"),
  icon: z
    .string()
    .optional()
    .describe("icon name (fontawesome or mintlify icon)"),
  pages: z
    .lazy(() => z.array(navItemSchema))
    .describe("pages and nested groups"),
  tag: z.string().optional().describe("tag badge to display"),
})

const updateNavInputSchema = z.object({
  action: z
    .enum([
      "add_page",
      "remove_page",
      "move_page",
      "add_group",
      "remove_group",
      "update_group",
      "replace_all",
    ])
    .describe("the navigation update action to perform"),
  afterGroup: z
    .string()
    .optional()
    .describe("insert new group after this group"),

  // for move_page
  fromGroup: z.string().optional().describe("source group for move"),
  group: z.string().optional().describe("target group name"),

  // for replace_all
  navigation: z
    .array(navItemSchema)
    .optional()
    .describe("complete navigation structure to replace with"),

  // for add_group, update_group
  newGroup: navGroupSchema.optional().describe("new group definition"),

  // for add_page
  page: z.string().optional().describe("page path to add/remove/move"),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("position within group (0-indexed)"),
  toGroup: z.string().optional().describe("destination group for move"),
})

type UpdateNavInput = z.infer<typeof updateNavInputSchema>

/**
 * find the docs.json file
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

type NavItem = string | NavGroup

/**
 * find a group by name recursively
 */
function findGroup(items: NavItem[], name: string): NavGroup | null {
  for (const item of items) {
    if (typeof item !== "string") {
      if (item.group === name) return item
      const found = findGroup(item.pages, name)
      if (found) return found
    }
  }
  return null
}

/**
 * remove a page from navigation recursively
 */
function removePage(items: NavItem[], page: string): boolean {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (typeof item === "string" && item === page) {
      items.splice(i, 1)
      return true
    }
    if (typeof item !== "string" && removePage(item.pages, page)) return true
  }
  return false
}

/**
 * remove a group from navigation recursively
 */
function removeGroup(items: NavItem[], name: string): boolean {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (typeof item !== "string") {
      if (item.group === name) {
        items.splice(i, 1)
        return true
      }
      if (removeGroup(item.pages, name)) return true
    }
  }
  return false
}

/**
 * add a page to a specific group
 */
function addPageToGroup(
  items: NavItem[],
  page: string,
  groupName: string,
  position?: number,
): boolean {
  const group = findGroup(items, groupName)
  if (!group) return false

  if (
    position !== undefined &&
    position >= 0 &&
    position <= group.pages.length
  ) {
    group.pages.splice(position, 0, page)
  } else {
    group.pages.push(page)
  }
  return true
}

/**
 * add a new group
 */
function addGroup(
  items: NavItem[],
  newGroup: NavGroup,
  afterGroup?: string,
): boolean {
  if (afterGroup) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      if (typeof item !== "string" && item.group === afterGroup) {
        items.splice(i + 1, 0, newGroup)
        return true
      }
    }
    return false
  }

  items.push(newGroup)
  return true
}

/**
 * update a group's metadata (icon, tag, expanded)
 */
function updateGroup(
  items: NavItem[],
  groupName: string,
  updates: Partial<NavGroup>,
): boolean {
  const group = findGroup(items, groupName)
  if (!group) return false

  if (updates.icon !== undefined) group.icon = updates.icon
  if (updates.tag !== undefined) group.tag = updates.tag
  if (updates.expanded !== undefined) group.expanded = updates.expanded
  if (updates.pages !== undefined) group.pages = updates.pages

  return true
}

/**
 * create the update_nav tool for modifying docs.json navigation
 */
export const createUpdateNavTool = (docsPath: string) => ({
  description:
    "update the docs.json navigation structure. supports adding/removing pages, " +
    "creating/modifying groups with icons and nested structure, moving pages between groups, " +
    "and replacing the entire navigation. always run read_nav first to understand the current structure.",
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps comprehensive nav update flow together
  execute: async (input: UpdateNavInput) => {
    try {
      const docsJsonPath = await findDocsJson(docsPath)

      if (!docsJsonPath) {
        return {
          error: "could not find docs.json in docs directory tree",
          success: false,
        }
      }

      const content = await readFile(docsJsonPath, "utf-8")
      const docsJson = JSON.parse(content)

      if (!docsJson.navigation) {
        docsJson.navigation = {}
      }

      if (!docsJson.navigation.groups) {
        docsJson.navigation.groups = []
      }

      const groups = docsJson.navigation.groups as NavItem[]
      let changed = false
      let message = ""

      switch (input.action) {
        case "add_page": {
          if (!input.page) {
            return {
              error: "page is required for add_page action",
              success: false,
            }
          }
          if (!input.group) {
            return {
              error: "group is required for add_page action",
              success: false,
            }
          }

          changed = addPageToGroup(
            groups,
            input.page,
            input.group,
            input.position,
          )
          message = changed
            ? `added ${input.page} to group "${input.group}"`
            : `group "${input.group}" not found`
          break
        }

        case "remove_page": {
          if (!input.page) {
            return {
              error: "page is required for remove_page action",
              success: false,
            }
          }

          changed = removePage(groups, input.page)
          message = changed
            ? `removed ${input.page} from navigation`
            : `page "${input.page}" not found`
          break
        }

        case "move_page": {
          if (!input.page) {
            return {
              error: "page is required for move_page action",
              success: false,
            }
          }
          if (!input.toGroup) {
            return {
              error: "toGroup is required for move_page action",
              success: false,
            }
          }

          // remove from current location
          const removed = removePage(groups, input.page)
          if (!removed) {
            return { error: `page "${input.page}" not found`, success: false }
          }

          // add to new location
          changed = addPageToGroup(
            groups,
            input.page,
            input.toGroup,
            input.position,
          )
          message = changed
            ? `moved ${input.page} to group "${input.toGroup}"`
            : `target group "${input.toGroup}" not found`
          break
        }

        case "add_group": {
          if (!input.newGroup) {
            return {
              error: "newGroup is required for add_group action",
              success: false,
            }
          }

          changed = addGroup(groups, input.newGroup, input.afterGroup)
          message = changed
            ? `added group "${input.newGroup.group}"${input.afterGroup ? ` after "${input.afterGroup}"` : ""}`
            : `after group "${input.afterGroup}" not found`
          break
        }

        case "remove_group": {
          if (!input.group) {
            return {
              error: "group is required for remove_group action",
              success: false,
            }
          }

          changed = removeGroup(groups, input.group)
          message = changed
            ? `removed group "${input.group}"`
            : `group "${input.group}" not found`
          break
        }

        case "update_group": {
          if (!input.group) {
            return {
              error: "group is required for update_group action",
              success: false,
            }
          }
          if (!input.newGroup) {
            return {
              error: "newGroup is required for update_group action",
              success: false,
            }
          }

          changed = updateGroup(groups, input.group, input.newGroup)
          message = changed
            ? `updated group "${input.group}"`
            : `group "${input.group}" not found`
          break
        }

        case "replace_all": {
          if (!input.navigation) {
            return {
              error: "navigation is required for replace_all action",
              success: false,
            }
          }

          docsJson.navigation.groups = input.navigation
          changed = true
          message = "replaced entire navigation structure"
          break
        }

        default:
          return { error: `unknown action: ${input.action}`, success: false }
      }

      if (changed) {
        await writeFile(docsJsonPath, `${JSON.stringify(docsJson, null, 2)}\n`)
      }

      return {
        message,
        path: docsJsonPath,
        success: changed,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      return { error: message, success: false }
    }
  },
  inputSchema: updateNavInputSchema,
})
