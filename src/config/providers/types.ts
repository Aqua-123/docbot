import type { NativeProviderName } from "./constants"

/**
 * OpenAI-compatible provider configuration
 * Use this for self-hosted models (LM Studio, Ollama, vLLM, etc.)
 */
export interface OpenAICompatibleProviderConfig {
  type: "openai-compatible"
  /** Identifier used in model IDs (e.g., "ollama" for "ollama/llama3") */
  name: string
  /** API endpoint URL (e.g., "http://localhost:11434/v1") */
  baseURL: string
  /** Optional API key */
  apiKey?: string
  /** Optional custom headers */
  headers?: Record<string, string>
}

/**
 * Native provider configuration
 * Use this to override default settings for built-in providers
 */
export interface NativeProviderConfig {
  /** Provider type from supported native providers */
  type: NativeProviderName
  /** Override the default API key (otherwise uses env var) */
  apiKey?: string
  /** Override the default base URL (useful for proxies) */
  baseURL?: string
}

/**
 * Union of all provider configuration types
 */
export type ProviderConfig = OpenAICompatibleProviderConfig | NativeProviderConfig
