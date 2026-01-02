import { z } from "zod"

// model identifier (e.g. "openai/gpt-5.2", "anthropic/claude-sonnet-4.5")
const modelIdSchema = z.string().regex(/^[\w-]+\/[\w.-]+$/, {
  message: "model id must be in format 'provider/model-name'",
})

export const docbotConfigSchema = z.object({
  // agent behavior settings
  agents: z
    .object({
      discoveryBudget: z.number().int().positive().optional(),
    })
    .optional(),

  // model overrides
  models: z
    .object({
      context: modelIdSchema.optional(),
      embedding: modelIdSchema.optional(),
      embeddingLarge: modelIdSchema.optional(),
      fast: modelIdSchema.optional(),
      nano: modelIdSchema.optional(),
      planning: modelIdSchema.optional(),
      planningHeavy: modelIdSchema.optional(),
      prose: modelIdSchema.optional(),
    })
    .optional(),

  // optional defaults for CLI inputs
  paths: z
    .object({
      codebase: z.union([z.string(), z.array(z.string())]).optional(),
      docs: z.string().optional(),
    })
    .optional(),
  // project identifier used for collection naming
  // defaults to sanitized package.json name
  projectSlug: z.string().optional(),

  // qdrant configuration
  qdrant: z
    .object({
      collections: z
        .object({
          code: z.string(),
          docs: z.string(),
        })
        .optional(),
      manifestPath: z
        .string()
        .optional()
        .describe("custom manifest path (defaults to .docbot/manifest.json)"),
      url: z.string().url().default("http://127.0.0.1:6333"),
    })
    .optional(),

  // server settings
  server: z
    .object({
      port: z.number().int().min(1).max(65535).optional(),
    })
    .optional(),
})

/** @public */
export type DocbotConfig = z.infer<typeof docbotConfigSchema>

// partial config is what users provide, we merge with defaults
export type DocbotUserConfig = z.input<typeof docbotConfigSchema>

// resolved config has all required fields filled
export interface ResolvedConfig {
  projectSlug: string
  qdrant: {
    url: string
    manifestPath: string
    collections: { docs: string; code: string }
  }
  models: {
    planning: string
    planningHeavy: string
    prose: string
    fast: string
    nano: string
    context: string
    embedding: string
    embeddingLarge: string
  }
  agents: {
    discoveryBudget: number
  }
  server: {
    port: number
  }
  paths: {
    cacheDir: string
    manifest: string
    docs?: string
    codebase?: string[]
  }
}
