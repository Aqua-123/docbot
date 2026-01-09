// public exports for user configuration files
// users can import from "docbot/config" in their docbot.config.ts

import { gateway as aiGateway } from "ai"
import type { DocbotUserConfig } from "./schema"

export {
  DEFAULT_AGENTS,
  DEFAULT_MODELS,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
  makeCollectionNames,
  sanitizeSlug,
} from "./defaults"
export {
  findProjectRoot,
  type LoadConfigOptions,
  loadConfig,
} from "./loader"
export type { DocbotUserConfig, ResolvedConfig } from "./schema"
export { docbotConfigSchema } from "./schema"

// Provider exports for user configuration
export {
  NATIVE_PROVIDERS,
  type NativeProviderName,
  type NativeProviderConfig,
  type OpenAICompatibleProviderConfig,
  type ProviderConfig,
} from "./providers"

/**
 * helper for defining a typed config file
 *
 * @example
 * ```ts
 * // docbot.config.ts
 * import { defineConfig } from "docbot/config"
 *
 * export default defineConfig({
 *   projectSlug: "my-docs",
 *   models: {
 *     planning: "openai/gpt-4o",
 *   },
 * })
 * ```
 */
export function defineConfig(config: DocbotUserConfig): DocbotUserConfig {
  return config
}

/**
 * re-export ai gateway for model configuration
 *
 * @example
 * ```ts
 * import { defineConfig, gateway } from "docbot/config"
 *
 * export default defineConfig({
 *   models: {
 *     planning: gateway("openai/gpt-4o"),
 *   },
 * })
 * ```
 */
export const gateway: typeof aiGateway = aiGateway
