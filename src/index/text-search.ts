import { $ } from "bun"
import { logCmd, logError, logInfo } from "../logger"
import type { SearchResult } from "../types"

/**
 * perform text search using ripgrep
 */
export async function textSearch(
  query: string,
  docsPath: string,
  limit = 10,
): Promise<SearchResult[]> {
  const args = buildRipgrepArgs(query, docsPath, limit)
  logCmd(`rg ${args.join(" ")}`)

  try {
    const result = await $`rg ${args}`.quiet()
    const matches = parseRipgrepResults(
      result.stdout.toString().trim().split("\n").filter(Boolean),
      limit,
    )
    logInfo(`text search found ${matches.length} results`)
    return matches
  } catch (error) {
    if (error instanceof Error && error.message.includes("exit code")) {
      logInfo("text search found 0 results")
      return []
    }
    logError("text search failed", error)
    throw error
  }
}

function buildRipgrepArgs(query: string, docsPath: string, limit: number) {
  return [
    "--json",
    "--max-count",
    String(limit * 2),
    "--ignore-case",
    "--type",
    "md",
    query,
    docsPath,
  ]
}

function parseRipgrepResults(lines: string[], limit: number) {
  const matches: SearchResult[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (matches.length >= limit) break
    const parsed = safeParse(line)
    if (!parsed || parsed.type !== "match") continue

    const path = parsed.data?.path?.text
    if (!path || seen.has(path)) continue
    seen.add(path)

    const matchText = parsed.data?.lines?.text ?? ""
    const lineNumber = parsed.data?.line_number ?? 0

    matches.push({
      content: matchText.trim(),
      id: `text-${path}-${lineNumber}`,
      path,
      score: 1.0,
      section: "",
    })
  }

  return matches
}

function safeParse(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
