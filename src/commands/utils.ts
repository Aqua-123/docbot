import { resolve } from "node:path"
import { Glob } from "bun"

/**
 * expand glob pattern to resolved paths
 *
 * accepts patterns like "{apps/helm,packages/{eden,shared,db}}/**" and expands globs
 * also supports comma-separated patterns like "apps/helm,packages/eden"
 * note: splits on top-level commas only (outside braces) to preserve brace patterns
 */
export async function expandCodebasePaths(
  codebaseArg: string | undefined,
): Promise<string[]> {
  if (!codebaseArg) return []

  const patterns = splitTopLevelCommas(codebaseArg)
  const resolved: string[] = []

  for (const pattern of patterns) {
    const glob = new Glob(pattern)
    for await (const match of glob.scan({ onlyFiles: false })) {
      const full = resolve(match)
      if (!resolved.includes(full)) {
        resolved.push(full)
      }
    }
  }

  return resolved
}

/**
 * split on commas only when they're outside braces
 * preserves brace patterns like {a,b} intact
 */
function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let current = ""
  let depth = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === "{") {
      depth++
      current += char
    } else if (char === "}") {
      depth--
      current += char
    } else if (char === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}
