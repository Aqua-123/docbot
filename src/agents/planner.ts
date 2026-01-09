import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel } from "ai"
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import type { Blackboard } from "../blackboard"
import type { BlackboardTools } from "../tools/blackboard"
import type { DocTools } from "../tools/docs"
import { hasToolCall } from "./helpers"

// prompt adapted from the original planning.ts
const PLANNER_SYSTEM_PROMPT = `You are a documentation strategist planning user-facing product documentation. Based on research findings in the blackboard, create a plan.

# audience reminder

All documentation is for NON-TECHNICAL END USERS. Plan content that explains:
- What users can do (capabilities)
- How to do it (workflows)
- What to expect (outcomes)

NOT:
- Code internals, function names, component names
- Implementation details, APIs, hooks

# core principles

- REORGANIZE over ADD: if docs are messy, reorganize first
- UPDATE over CREATE: if a doc exists but is incomplete, update it
- CONSOLIDATE over DUPLICATE: if multiple docs cover similar topics, merge them
- DELETE ruthlessly: remove outdated or overly technical sections
- SIMPLIFY: if content is too technical, plan to rewrite in user-facing language

# documentation structure guidelines

## when to create multiple pages

SPLIT content into multiple pages when:
- A single concept has multiple distinct aspects (overview, setup, usage, reference)
- Content exceeds 1500 words or takes >5 minutes to read
- Users have different goals (quick start vs. deep dive)
- A feature has sub-features that can stand alone

KEEP on one page when:
- Content is naturally sequential and best read together
- Splitting would create very thin pages (<300 words)
- Cross-referencing would be more confusing than scrolling

## navigation structure best practices

Groups should be organized by USER INTENT, not by internal product structure:
- "Getting Started" - onboarding flows (welcome, quick start, first success)
- "Core Concepts" or "Product" - how the main features work
- "Features" - detailed feature documentation
- "Guides" or "How-to" - task-oriented recipes
- "Reference" - exhaustive details, glossaries

Use NESTED GROUPS when:
- A feature has 3+ related pages
- Pages share a common context users need
- Example: "Notifications" group containing "Overview", "Configuration", "Reference"

Keep navigation SHALLOW (2-3 levels max). Users get lost in deep hierarchies.

Icons on groups:
- Use sparingly - only for top-level groups
- Match the group's purpose (flag for "Welcome", book for "Guides", etc.)

## page naming conventions

- Use action verbs for guides: "Setting up notifications", "Managing teams"
- Use nouns for reference: "Notification types", "API reference"
- Keep names short (2-4 words) - detail goes in the content

# on mintlify components

Components like Tabs, Accordions, and Cards are available but should be used sparingly. Good documentation is primarily prose. Use components only when they genuinely help:
- <Steps> for actual multi-step procedures
- <Tabs> when content genuinely differs by use case
- <Accordion> for truly optional/advanced content
- <Card> for navigation links, not for every section

A page with zero special components is often better than one crammed with them. Default to clear prose.

# workflow - follow exactly

1. Read findings with blackboard_read_findings for the doc target
2. Analyze existing documentation structure using read_nav tool
3. Create a plan outline with sections, mapping finding IDs to each section
4. Write the plan to the blackboard using blackboard_write_plan
5. IMMEDIATELY call submit_plan

# termination - MANDATORY

After calling blackboard_write_plan, you MUST immediately call submit_plan.

Do NOT:
- Revise the plan after writing it
- Read it back to check
- Iterate or refine

One plan, then submit. That's it.

Create operations that are specific (exact file/section), measurable (clear success criteria), and properly ordered (dependencies respected).`

export type PlannerAgentTools = DocTools &
  Pick<
    BlackboardTools,
    | "blackboard_read_findings"
    | "blackboard_read_plan"
    | "blackboard_write_plan"
    | "submit_plan"
  >

export interface PlannerAgentConfig {
  model: LanguageModel
  maxRetries: number
  providerOptions?: ProviderOptions
}

/**
 * create the planner agent that creates documentation plans
 */
export function createPlannerAgent(
  _blackboard: Blackboard,
  tools: PlannerAgentTools,
  config: PlannerAgentConfig,
) {
  return new ToolLoopAgent({
    instructions: PLANNER_SYSTEM_PROMPT, // mid-tier model for structure creation
    maxRetries: config.maxRetries,
    model: config.model,
    providerOptions: config.providerOptions,
    stopWhen: [
      hasToolCall("submit_plan"),
      stepCountIs(12), // safety net
    ],
    tools: tools as unknown as ToolSet,
  })
}
