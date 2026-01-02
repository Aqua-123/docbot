import { z } from "zod"

// phases of the documentation agent workflow (legacy - used for types only)
// the multi-agent architecture uses doc target status instead:
// "pending" | "researching" | "planning" | "writing" | "complete"
export type Phase = "analysis" | "planning" | "execution" | "review"

// operation types for documentation changes
const operationTypeSchema = z.enum([
  "update",
  "create",
  "move",
  "delete",
  "consolidate",
  "reorganize",
])

// a single operation in the documentation plan
const documentationOperationSchema = z.object({
  dependencies: z
    .array(z.string())
    .describe("operation ids that must complete first, or empty array if none"),
  description: z.string().describe("what this operation will do"),
  id: z.string().describe("unique identifier for the operation"),
  priority: z.number().min(1).max(5).describe("1 = highest priority"),
  rationale: z.string().describe("why this operation is needed"),
  section: z
    .string()
    .describe(
      "specific section within the doc, or empty string for whole file",
    ),
  sourcePath: z
    .string()
    .describe(
      "source path for move/consolidate, or empty string if not applicable",
    ),
  targetPath: z.string().describe("path to the target doc file"),
  type: operationTypeSchema,
})

// the full documentation plan returned by the planning agent
export const documentationPlanSchema = z.object({
  estimatedImpact: z.object({
    filesCreated: z.number(),
    filesDeleted: z.number(),
    filesModified: z.number(),
    sectionsReorganized: z.number(),
  }),
  operations: z.array(documentationOperationSchema),
  strategy: z
    .enum(["reorganize-first", "update-in-place", "create-new", "consolidate"])
    .describe("overall approach"),
  summary: z.string().describe("high-level summary of what will be done"),
  warnings: z
    .array(z.string())
    .describe("potential issues or risks, or empty array if none"),
})

// doc chunk stored in qdrant
export interface DocChunk {
  id: string
  path: string
  section: string
  content: string
  vector: number[]
}

// code chunk stored in qdrant (separate collection)
export interface CodeChunk {
  id: string
  path: string
  symbol: string
  symbolType:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "const"
    | "export"
    | "block"
  language: string
  content: string
  startLine: number
  endLine: number
  vector: number[]
}

// search result from vector/text search
export interface SearchResult {
  id: string
  path: string
  section: string
  content: string
  score: number
}

// mdx document structure
export interface MdxDocument {
  path: string
  frontmatter: Record<string, unknown>
  sections: MdxSection[]
  rawContent: string
}

export interface MdxSection {
  id: string
  heading: string
  level: number
  content: string
  startLine: number
  endLine: number
}

// server context shared across routes
export interface ServerContext {
  docsPath: string
  codebasePaths: string[]
  qdrantUrl: string
  interactive: boolean
}
