import type { AnthropicProviderOptions } from "@ai-sdk/anthropic"
import { cohere } from "@ai-sdk/cohere"
import { devToolsMiddleware } from "@ai-sdk/devtools"
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google"
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel, RerankingModel } from "ai"
import { gateway, wrapLanguageModel } from "ai"
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
      context: withDevTools(gateway(resolved.models.context)),
      embedding: resolved.models.embedding,
      embeddingLarge: resolved.models.embeddingLarge,
      fast: withDevTools(gateway(resolved.models.fast)),
      nano: withDevTools(gateway(resolved.models.nano)),
      planning: withDevTools(gateway(resolved.models.planning)),
      planningHeavy: withDevTools(gateway(resolved.models.planningHeavy)),
      prose: withDevTools(gateway(resolved.models.prose)),
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

// legacy config export for backward compatibility during migration
// commands should migrate to using createRuntimeConfig(resolvedConfig)
import {
  DEFAULT_AGENTS,
  DEFAULT_MODELS,
  DEFAULT_QDRANT_URL,
  DEFAULT_SERVER_PORT,
} from "./config/defaults"

export const config: RuntimeConfig = {
  agents: {
    discoveryBudget: DEFAULT_AGENTS.discoveryBudget,

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
              DEFAULT_MODELS.planning,
              DEFAULT_MODELS.prose,
              DEFAULT_MODELS.context,
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

      planner: {
        maxRetries: 3,
        providerOptions: {
          gateway: {
            models: [DEFAULT_MODELS.planning, DEFAULT_MODELS.prose],
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
          gateway: {
            models: [DEFAULT_MODELS.fast, DEFAULT_MODELS.nano],
          },
        } satisfies ProviderOptions,
      },

      userInteraction: {
        maxRetries: 3,
        providerOptions: {
          gateway: {
            models: [DEFAULT_MODELS.fast, DEFAULT_MODELS.nano],
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
              DEFAULT_MODELS.prose,
              DEFAULT_MODELS.fast,
              DEFAULT_MODELS.context,
              DEFAULT_MODELS.planningHeavy,
            ],
          },
          google: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: "medium",
            },
          } satisfies GoogleGenerativeAIProviderOptions,
          openai: {
            reasoningEffort: "high",
            textVerbosity: "low",
          } satisfies OpenAIResponsesProviderOptions,
        } satisfies ProviderOptions,
      },
    },
  },
  models: {
    context: withDevTools(gateway(DEFAULT_MODELS.context)),
    embedding: DEFAULT_MODELS.embedding as string,
    embeddingLarge: DEFAULT_MODELS.embeddingLarge as string,
    fast: withDevTools(gateway(DEFAULT_MODELS.fast)),
    nano: withDevTools(gateway(DEFAULT_MODELS.nano)),
    planning: withDevTools(gateway(DEFAULT_MODELS.planning)),
    planningHeavy: withDevTools(gateway(DEFAULT_MODELS.planningHeavy)),
    prose: withDevTools(gateway(DEFAULT_MODELS.prose)),
    reranker: cohere.reranking("rerank-v3.5"),
  },

  qdrant: {
    collections: {
      code: { name: "docbot_code", vectorSize: 1536 },
      docs: { name: "docbot_docs", vectorSize: 1536 },
    },
    manifestPath: process.env.DOCBOT_MANIFEST_PATH ?? ".docbot/manifest.json",
    url: process.env.QDRANT_URL ?? DEFAULT_QDRANT_URL,
  },

  server: {
    port: Number(process.env.DOCBOT_PORT) || DEFAULT_SERVER_PORT,
  },
}
