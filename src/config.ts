import type { AnthropicProviderOptions } from "@ai-sdk/anthropic"
import { cohere } from "@ai-sdk/cohere"
import { devToolsMiddleware } from "@ai-sdk/devtools"
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google"
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel, RerankingModel } from "ai"
import { wrapLanguageModel } from "ai"
import { getModel, initializeProviders } from "./config/providers"
import type { ResolvedConfig } from "./config/schema"

const withDevTools = (
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
) => {
  // only apply dev tools in development
  if (process.env.NODE_ENV === "production") {
    return model
  }
  return wrapLanguageModel({
    middleware: devToolsMiddleware(),
    model,
  })
}

/**
 * runtime configuration type with model instances
 */
export interface RuntimeConfig {
  models: {
    planning: LanguageModel
    planningHeavy: LanguageModel
    prose: LanguageModel
    fast: LanguageModel
    nano: LanguageModel
    context: LanguageModel
    embedding: string
    embeddingLarge: string
    reranker: RerankingModel
  }
  qdrant: {
    url: string
    manifestPath: string
    collections: {
      docs: { name: string; vectorSize: number }
      code: { name: string; vectorSize: number }
    }
  }
  server: { port: number }
  agents: {
    discoveryBudget: number
    runtime: {
      orchestrator: { maxRetries: number; providerOptions?: ProviderOptions }
      research: { maxRetries: number; providerOptions?: ProviderOptions }
      planner: { maxRetries: number; providerOptions?: ProviderOptions }
      writer: { maxRetries: number; providerOptions?: ProviderOptions }
      userInteraction: { maxRetries: number; providerOptions?: ProviderOptions }
    }
  }
}

/**
 * create runtime configuration with actual model instances from resolved config
 */
export function createRuntimeConfig(resolved: ResolvedConfig): RuntimeConfig {
  // Initialize the provider registry with user-configured providers
  // This determines whether to use gateway (default) or native providers
  initializeProviders(resolved.providers)

  return {
    agents: {
      discoveryBudget: resolved.agents.discoveryBudget,

      runtime: {
        orchestrator: {
          maxRetries: 3,
          providerOptions: {
            anthropic: {
              effort: "medium",
              sendReasoning: false,
            } satisfies AnthropicProviderOptions,
            gateway: {
              models: [
                resolved.models.planning,
                resolved.models.prose,
                resolved.models.context,
              ],
            },
            google: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: "medium",
              },
            } satisfies GoogleGenerativeAIProviderOptions,
            openai: {
              reasoningEffort: "medium",
              textVerbosity: "low",
            } satisfies OpenAIResponsesProviderOptions,
          } satisfies ProviderOptions,
        },

        planner: {
          maxRetries: 3,
          providerOptions: {
            gateway: {
              models: [resolved.models.planning, resolved.models.prose],
            },
            openai: {
              reasoningEffort: "medium",
              textVerbosity: "low",
            } satisfies OpenAIResponsesProviderOptions,
          } satisfies ProviderOptions,
        },

        research: {
          maxRetries: 3,
          providerOptions: {
            anthropic: {
              effort: "medium",
              sendReasoning: false,
            } satisfies AnthropicProviderOptions,
            gateway: {
              models: [resolved.models.fast, resolved.models.nano],
            },
            google: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: "medium",
              },
            } satisfies GoogleGenerativeAIProviderOptions,
          } satisfies ProviderOptions,
        },

        userInteraction: {
          maxRetries: 3,
          providerOptions: {
            gateway: {
              models: [resolved.models.fast, resolved.models.nano],
            },
          } satisfies ProviderOptions,
        },

        writer: {
          maxRetries: 3,
          providerOptions: {
            anthropic: {
              effort: "medium",
              sendReasoning: false,
            } satisfies AnthropicProviderOptions,
            gateway: {
              models: [
                resolved.models.prose,
                resolved.models.planningHeavy,
                resolved.models.context,
              ],
            },
            google: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: "medium",
              },
            } satisfies GoogleGenerativeAIProviderOptions,
          } satisfies ProviderOptions,
        },
      },
    },
    models: {
      context: withDevTools(getModel(resolved.models.context)),
      embedding: resolved.models.embedding,
      embeddingLarge: resolved.models.embeddingLarge,
      fast: withDevTools(getModel(resolved.models.fast)),
      nano: withDevTools(getModel(resolved.models.nano)),
      planning: withDevTools(getModel(resolved.models.planning)),
      planningHeavy: withDevTools(getModel(resolved.models.planningHeavy)),
      prose: withDevTools(getModel(resolved.models.prose)),
      reranker: cohere.reranking("rerank-v3.5"),
    },

    qdrant: {
      collections: {
        code: { name: resolved.qdrant.collections.code, vectorSize: 1536 },
        docs: { name: resolved.qdrant.collections.docs, vectorSize: 1536 },
      },
      manifestPath: resolved.qdrant.manifestPath,
      url: resolved.qdrant.url,
    },

    server: {
      port: resolved.server.port,
    },
  }
}

/** @public */
export {
  DEFAULT_AGENTS,
  DEFAULT_MODELS,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
  makeCollectionNames,
  sanitizeSlug,
} from "./config/defaults"
/** @public */
export { defineConfig } from "./config/index"
// re-export from config modules for external use
export {
  findProjectRoot,
  type LoadConfigOptions,
  loadConfig,
} from "./config/loader"
export type { DocbotUserConfig, ResolvedConfig } from "./config/schema"


