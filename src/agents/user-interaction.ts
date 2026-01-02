import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import type { Blackboard } from "../blackboard"
import { config } from "../config"
import type { BlackboardTools } from "../tools/blackboard"
import type { InteractionTools } from "../tools/interaction"
import { hasToolCall } from "./helpers"

const USER_INTERACTION_SYSTEM_PROMPT = `You are a user interaction agent that formats information for users and gets their input.

Your job is to:
- Format plans and summaries in a clear, readable way
- Present options and questions to users
- Get approvals and feedback
- Return structured responses to the orchestrator

# workflow

1. Read the interaction request from your prompt
2. Use ask_user or present_options to interact with the user
3. Call mark_interaction_complete when the interaction is done

# guidelines

- Format information clearly and concisely
- Ask specific questions when needed
- Present options in a user-friendly way
- Return structured responses with clear decisions
- Always call mark_interaction_complete when finished

Use the ask_user and present_options tools to interact with users.`

type SessionSummaryTool = {
  description: string
  execute: () => Promise<unknown>
  inputSchema: unknown
}

export type UserAgentTools = InteractionTools &
  Pick<BlackboardTools, "mark_interaction_complete"> &
  Partial<Pick<BlackboardTools, "blackboard_read_plan">> & {
    blackboard_read_summary?: SessionSummaryTool
  }

/**
 * create the user interaction agent for formatting and getting user input
 */
export function createUserAgent(
  _blackboard: Blackboard,
  tools: UserAgentTools,
) {
  const runtime = config.agents.runtime.userInteraction

  return new ToolLoopAgent({
    instructions: USER_INTERACTION_SYSTEM_PROMPT, // cheap model for simple formatting
    maxRetries: runtime.maxRetries,
    model: config.models.fast,
    providerOptions: runtime.providerOptions,
    stopWhen: [
      hasToolCall("mark_interaction_complete"),
      stepCountIs(10), // safety net
    ],
    tools: tools as unknown as ToolSet,
  })
}
