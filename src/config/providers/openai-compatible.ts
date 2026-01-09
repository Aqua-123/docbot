import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { OpenAICompatibleProviderConfig } from "./types"

/**
 * Create an OpenAI-compatible provider instance
 * Use this for self-hosted models or any API that implements the OpenAI spec
 *
 * @example
 * ```ts
 * // LM Studio
 * createOpenAICompatibleProvider({
 *   type: "openai-compatible",
 *   name: "lmstudio",
 *   baseURL: "http://localhost:1234/v1",
 * })
 *
 * // Ollama
 * createOpenAICompatibleProvider({
 *   type: "openai-compatible",
 *   name: "ollama",
 *   baseURL: "http://localhost:11434/v1",
 * })
 * ```
 */
export function createOpenAICompatibleProvider(
  config: OpenAICompatibleProviderConfig,
) {
  return createOpenAICompatible({
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: config.headers,
  })
}
