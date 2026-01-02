import { join } from "node:path"
import { z } from "zod"
import type { DocIndex } from "../../index/doc-index"
import { logTool, logToolResult } from "../../logger"
import { parseMdx } from "../../mdx/parser"

const WHITESPACE_PATTERN = /\s+/

const analyzeInputSchema = z.object({
  path: z.string().describe("path to the doc file relative to docs root"),
})

export const createAnalyzeDocTool = (docsPath: string, docIndex: DocIndex) => ({
  description:
    "analyze a documentation file for quality issues, structure problems, and potential improvements",
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps analysis heuristics together
  execute: async ({ path }: z.infer<typeof analyzeInputSchema>) => {
    logTool("analyze_doc", { path })
    const start = performance.now()

    const fullPath = join(docsPath, path)

    try {
      const content = await Bun.file(fullPath).text()
      const doc = parseMdx(path, content)

      const issues: string[] = []
      const suggestions: string[] = []

      // check for missing frontmatter
      if (Object.keys(doc.frontmatter).length === 0) {
        issues.push("missing frontmatter")
        suggestions.push(
          "add frontmatter with title, description, and other metadata",
        )
      }

      // check for missing title in frontmatter
      if (!doc.frontmatter.title) {
        issues.push("missing title in frontmatter")
      }

      // check for very short sections
      for (const section of doc.sections) {
        if (section.content.length < 50 && section.level <= 2) {
          issues.push(
            `section "${section.heading}" is very short (${section.content.length} chars)`,
          )
        }
      }

      // check for very long sections without subsections
      for (const section of doc.sections) {
        if (section.content.length > 3000 && section.level <= 2) {
          suggestions.push(
            `section "${section.heading}" is very long - consider breaking into subsections`,
          )
        }
      }

      // check for inconsistent heading levels
      let lastLevel = 0
      for (const section of doc.sections) {
        if (section.level > lastLevel + 1) {
          issues.push(
            `inconsistent heading levels: jumped from h${lastLevel} to h${section.level} at "${section.heading}"`,
          )
        }
        lastLevel = section.level
      }

      // check for duplicate content in other docs
      const firstSection = doc.sections[0]
      if (firstSection && firstSection.content.length > 100) {
        const similar = await docIndex.findSimilarDocs(
          firstSection.content,
          3,
          path,
        )
        const duplicates = similar.filter((s) => s.score > 0.85)
        if (duplicates.length > 0) {
          issues.push(
            `potential duplicate content found in: ${duplicates.map((d) => d.path).join(", ")}`,
          )
        }
      }

      const result = {
        frontmatter: doc.frontmatter,
        issues,
        path,
        quality:
          issues.length === 0
            ? "good"
            : issues.length < 3
              ? "fair"
              : "needs-improvement",
        sectionCount: doc.sections.length,
        suggestions,
        wordCount: content.split(WHITESPACE_PATTERN).length,
      }
      logToolResult(
        { issues: issues.length, quality: result.quality },
        performance.now() - start,
      )
      return result
    } catch {
      logToolResult({ error: "failed to analyze" }, performance.now() - start)
      return { error: `failed to analyze file: ${path}` }
    }
  },
  inputSchema: analyzeInputSchema,
})

const coverageInputSchema = z.object({
  topic: z.string().describe("the topic or feature to check coverage for"),
})

export const createCheckCoverageTool = (
  _docsPath: string,
  docIndex: DocIndex,
) => ({
  description: "check if a topic or feature is covered in the documentation",
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps coverage scoring together
  execute: async ({ topic }: z.infer<typeof coverageInputSchema>) => {
    logTool("check_coverage", { topic })
    const start = performance.now()

    // search for related docs
    const semanticResults = await docIndex.semanticSearch(topic, 5)
    const exactResults = await docIndex.exactSearch(topic, 5)

    // combine and dedupe
    const allPaths = new Set<string>()
    const results: Array<{ path: string; score: number; excerpt: string }> = []

    for (const r of semanticResults) {
      if (!allPaths.has(r.path)) {
        allPaths.add(r.path)
        results.push({
          excerpt: r.content.slice(0, 200),
          path: r.path,
          score: r.score,
        })
      }
    }

    for (const r of exactResults) {
      if (!allPaths.has(r.path)) {
        allPaths.add(r.path)
        results.push({
          excerpt: r.content.slice(0, 200),
          path: r.path, // text search doesn't have semantic scores
          score: 0.5,
        })
      }
    }

    // determine coverage level
    const highRelevance = results.filter((r) => r.score > 0.8)
    const mediumRelevance = results.filter(
      (r) => r.score > 0.6 && r.score <= 0.8,
    )

    let coverage: "comprehensive" | "partial" | "minimal" | "none"
    if (highRelevance.length >= 2) {
      coverage = "comprehensive"
    } else if (highRelevance.length === 1 || mediumRelevance.length >= 2) {
      coverage = "partial"
    } else if (results.length > 0) {
      coverage = "minimal"
    } else {
      coverage = "none"
    }

    const result = {
      coverage,
      relatedDocs: results.slice(0, 5),
      suggestion:
        coverage === "none"
          ? `no documentation found for "${topic}" - consider creating a new doc`
          : coverage === "minimal"
            ? `limited coverage of "${topic}" - consider expanding existing docs or creating new ones`
            : null,
      topic,
    }

    logToolResult({ coverage, docs: results.length }, performance.now() - start)
    return result
  },
  inputSchema: coverageInputSchema,
})
