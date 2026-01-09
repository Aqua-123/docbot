import type { LanguageModelV3 } from "@ai-sdk/provider"
import { gateway } from "ai"
import {
  createConfiguredProvider,
  getDefaultProvider,
  isNativeProvider,
} from "./builtin"
import { NATIVE_PROVIDERS, type NativeProviderName } from "./constants"
import { createOpenAICompatibleProvider } from "./openai-compatible"
import type {
  NativeProviderConfig,
  OpenAICompatibleProviderConfig,
  ProviderConfig,
} from "./types"

type ModelFactory = (modelId: string) => LanguageModelV3

/**
 * Provider Registry
 *
 * Manages model routing to different providers:
 * - Default: Uses Vercel AI Gateway
 * - With providers config: Uses native providers directly or custom endpoints
 */
class ProviderRegistry {
  private customProviders = new Map<string, ModelFactory>()
  private nativeOverrides = new Map<NativeProviderName, ModelFactory>()
  private useGateway = true // Default: use Vercel Gateway

  /**
   * Register providers from user configuration
   * Any provider config switches off gateway mode
   */
  registerProviders(configs: ProviderConfig[]) {
    if (configs.length > 0) {
      this.useGateway = false
    }

    for (const config of configs) {
      if (config.type === "openai-compatible") {
        this.registerOpenAICompatible(config)
      } else {
        this.registerNativeOverride(config)
      }
    }
  }

  private registerOpenAICompatible(config: OpenAICompatibleProviderConfig) {
    const provider = createOpenAICompatibleProvider(config)
    this.customProviders.set(config.name, (model) => provider(model))
  }

  private registerNativeOverride(config: NativeProviderConfig) {
    const provider = createConfiguredProvider(config)
    this.nativeOverrides.set(config.type, (model) => provider(model))
  }

  /**
   * Get a model instance by ID
   *
   * @param modelId - Model identifier in "provider/model-name" format
   * @returns Language model instance
   *
   * @example
   * ```ts
   * getModel("openai/gpt-4o")
   * getModel("anthropic/claude-sonnet-4.5")
   * getModel("ollama/llama3")  // requires openai-compatible config
   * ```
   */
  getModel(modelId: string): LanguageModelV3 {
    const slashIndex = modelId.indexOf("/")
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model ID "${modelId}". Expected format: "provider/model-name"`,
      )
    }

    const providerName = modelId.slice(0, slashIndex)
    const modelName = modelId.slice(slashIndex + 1)

    // 1. Check custom OpenAI-compatible providers first
    if (this.customProviders.has(providerName)) {
      return this.customProviders.get(providerName)!(modelName)
    }

    // 2. Check native provider overrides (user configured with custom apiKey/baseURL)
    if (this.nativeOverrides.has(providerName as NativeProviderName)) {
      return this.nativeOverrides.get(providerName as NativeProviderName)!(
        modelName,
      )
    }

    // 3. If using gateway mode (default when no providers configured), route through gateway
    if (this.useGateway) {
      return gateway(modelId)
    }

    // 4. Use default native provider (direct to provider API with env vars)
    if (isNativeProvider(providerName)) {
      const provider = getDefaultProvider(providerName)
      return provider(modelName)
    }

    // 5. Unknown provider - provide helpful error
    const supportedList = NATIVE_PROVIDERS.join(", ")
    throw new Error(
      `Unknown provider "${providerName}" in model ID "${modelId}". ` +
        `Supported native providers: ${supportedList}. ` +
        `For custom endpoints, add an openai-compatible provider to your config.`,
    )
  }
}

// Singleton instance
let registry: ProviderRegistry | null = null

/**
 * Initialize the provider registry with user configuration
 * Call this once when loading the runtime config
 */
export function initializeProviders(configs: ProviderConfig[] = []) {
  registry = new ProviderRegistry()
  registry.registerProviders(configs)
  return registry
}

/**
 * Get a model instance by ID
 * If registry hasn't been initialized, uses gateway (default behavior)
 */
export function getModel(modelId: string): LanguageModelV3 {
  if (!registry) {
    registry = new ProviderRegistry()
  }
  return registry.getModel(modelId)
}

/**
 * Get the current provider registry instance
 */
export function getRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry()
  }
  return registry
}

// Re-export types and constants
export { NATIVE_PROVIDERS, type NativeProviderName } from "./constants"
export type {
  NativeProviderConfig,
  OpenAICompatibleProviderConfig,
  ProviderConfig,
} from "./types"
