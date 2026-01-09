import { anthropic, createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI, google } from "@ai-sdk/google"
import { createGroq, groq } from "@ai-sdk/groq"
import { createOpenAI, openai } from "@ai-sdk/openai"
import type { NativeProviderName } from "./constants"
import type { NativeProviderConfig } from "./types"

/**
 * Default provider instances
 * These use standard environment variables for API keys:
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 * - GOOGLE_GENERATIVE_AI_API_KEY
 * - GROQ_API_KEY
 */
const DEFAULT_PROVIDERS = {
  anthropic,
  google,
  groq,
  openai,
} as const

/**
 * Factory functions to create configured provider instances
 */
const PROVIDER_FACTORIES = {
  anthropic: createAnthropic,
  google: createGoogleGenerativeAI,
  groq: createGroq,
  openai: createOpenAI,
} as const

/**
 * Get the default provider instance (uses env vars)
 */
export function getDefaultProvider(name: NativeProviderName) {
  return DEFAULT_PROVIDERS[name]
}

/**
 * Create a configured provider instance with custom settings
 */
export function createConfiguredProvider(config: NativeProviderConfig) {
  const factory = PROVIDER_FACTORIES[config.type]
  return factory({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
}

/**
 * Check if a provider name is a supported native provider
 */
export function isNativeProvider(name: string): name is NativeProviderName {
  return name in DEFAULT_PROVIDERS
}
