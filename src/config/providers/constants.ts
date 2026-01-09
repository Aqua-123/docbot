/**
 * Single source of truth for all supported native AI SDK providers
 *
 * Phase 1: Core providers
 * To add a new provider:
 * 1. Add it to this array
 * 2. Add the SDK import and factory in builtin.ts
 * 3. Install the @ai-sdk/{provider} package
 */
export const NATIVE_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
] as const

export type NativeProviderName = (typeof NATIVE_PROVIDERS)[number]
