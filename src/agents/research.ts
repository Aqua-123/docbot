import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel } from "ai"
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import type { Blackboard } from "../blackboard"
import type { BlackboardTools } from "../tools/blackboard"
import type { CodebaseTools } from "../tools/codebase"
import type { DocTools } from "../tools/docs"
import { hasToolCall } from "./helpers"

// prompt adapted from the original analysis.ts
const RESEARCH_SYSTEM_PROMPT = `You are a documentation research agent for user-facing product docs. Your job is to find and filter relevant information about what needs to be documented.

# critical rules

- use the right search tool:
  - code_search for exact identifiers/regex (types, functions, constants)
  - semantic_code_search for conceptual/natural language queries (e.g. 'where do we handle authentication')
- ALWAYS use code_search/semantic_code_search and other tools to discover what the product actually does
- NEVER assume or guess about features - search first
- Translate code findings into user-facing language (what users can do, not implementation details)
- Focus on product capabilities and user workflows, not code structure

# workflow - follow exactly

1. Do 5-8 targeted searches (code_search, semantic_code_search, search_docs)
2. Record each useful finding with blackboard_write_finding
3. IMMEDIATELY call mark_research_complete after recording findings

# termination - MANDATORY

After completing 5-8 searches and recording findings, you MUST call mark_research_complete.

Do NOT:
- Search for "more completeness" beyond 8 searches
- Wait until you feel "ready"
- Iterate or refine findings after recording them

Your job is discovery, not perfection. Record what you found and terminate.

# output format

Record findings using blackboard_write_finding. Each finding should have:
- A clear summary of what was found
- The file path (if applicable)
- A relevance score (0-1)
- The type (code, doc, api, or concept)

# guidelines

- Be concise but complete
- Write findings for non-technical users
- Don't ask for confirmation - proceed automatically
- Don't say "I can help with..." or similar filler
- Describe features in terms of what users can accomplish, not code internals`

export type ResearchAgentTools = DocTools &
  Partial<CodebaseTools> &
  Pick<
    BlackboardTools,
    | "blackboard_read_finding"
    | "blackboard_read_findings"
    | "blackboard_write_finding"
    | "mark_research_complete"
  >

export interface ResearchAgentConfig {
  model: LanguageModel
  maxRetries: number
  providerOptions?: ProviderOptions
}

/**
 * create the research agent that finds and filters information
 */
export function createResearchAgent(
  _blackboard: Blackboard,
  tools: ResearchAgentTools,
  config: ResearchAgentConfig,
) {
  return new ToolLoopAgent({
    instructions: RESEARCH_SYSTEM_PROMPT, // cheap model for high-volume reading
    maxRetries: config.maxRetries,
    model: config.model,
    providerOptions: config.providerOptions,
    stopWhen: [
      hasToolCall("mark_research_complete"),
      stepCountIs(15), // safety net
    ],
    tools: tools as unknown as ToolSet,
  })
}
