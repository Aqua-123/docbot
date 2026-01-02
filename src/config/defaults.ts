// default configuration values for docbot

export const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333"
export const DEFAULT_SERVER_PORT = 3070

export const DEFAULT_MODELS = {
  context: "google/gemini-3-pro-preview",
  embedding: "openai/text-embedding-3-small",
  embeddingLarge: "openai/text-embedding-3-large",
  fast: "openai/gpt-5.2",
  nano: "google/gemini-3-flash",
  planning: "openai/gpt-5.2",
  planningHeavy: "anthropic/claude-opus-4.5",
  prose: "anthropic/claude-sonnet-4.5",
} as const

export const DEFAULT_AGENTS = {
  discoveryBudget: 6,
} as const

/**
 * generate collection names from project slug
 */
export function makeCollectionNames(slug: string) {
  return {
    code: `docbot_${slug}_code`,
    docs: `docbot_${slug}_docs`,
  }
}

/**
 * sanitize a string for use as a project slug
 * lowercase, alphanumeric and hyphens only
 */
export function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
