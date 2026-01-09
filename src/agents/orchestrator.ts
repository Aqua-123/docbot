import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import { z } from "zod"
import type { Blackboard } from "../blackboard"
import type { SessionSummary } from "../blackboard/types"
import type { RuntimeConfig } from "../config"
import { createBlackboardTools } from "../tools/blackboard"
import type { CodebaseTools } from "../tools/codebase"
import type { DocTools } from "../tools/docs"
import type { InteractionTools } from "../tools/interaction"
import { createWorkflowTools } from "../tools/workflow"
import { hasToolCall } from "./helpers"
import { createPlannerAgent, type PlannerAgentTools } from "./planner"
import { createResearchAgent, type ResearchAgentTools } from "./research"
import { createUserAgent, type UserAgentTools } from "./user-interaction"
import { createWriterAgent, type WriterAgentTools } from "./writer"

export interface OrchestratorContext {
  docsPath: string
  codebasePaths: string[]
}

/**
 * format session state for injection into agent context
 */
function formatSessionContext(summary: SessionSummary): string {
  const lines = [
    `phase: ${summary.currentPhase}`,
    `findings: ${summary.totalFindings}`,
    `plans: ${summary.totalPlans}`,
    `artifacts: ${summary.totalArtifacts}`,
  ]

  if (summary.docTargets.length > 0) {
    lines.push("targets:")
    for (const t of summary.docTargets) {
      lines.push(`  - ${t.name}: ${t.status}`)
    }
  }

  return lines.join("\n")
}

function buildSystemPrompt(context: OrchestratorContext): string {
  const codebaseSection =
    context.codebasePaths.length > 0
      ? `Codebase paths: ${context.codebasePaths.join(", ")}`
      : "No codebase paths provided - documentation-only mode."

  return `You are a documentation orchestrator that coordinates specialists to create documentation.

# context

Documentation path: ${context.docsPath}
${codebaseSection}

# role

You coordinate specialists (research, planner, writer, user) by delegating tasks. You NEVER see raw file content - only summaries and IDs from the blackboard.

# session awareness

Before each action, check the [SESSION STATE] block injected into your context. This tells you what work has already been done in this session.

- If findings exist and user asks for edits: skip research, use existing findings
- If a plan exists and is approved: proceed to writing without re-planning
- If artifacts exist: user is likely asking for refinements or follow-ups
- Match effort to task: quick edits don't need full research cycles

For simple requests (edits, fixes, questions) in established sessions:
- Use existing findings/plans when relevant
- Go directly to writing if the scope is clear
- Don't create new doc targets for minor changes to existing work

For comprehensive requests (new documentation, major rewrites):
- Follow the full workflow below
- Create doc targets, research, plan, then write

# workflow (for comprehensive tasks)

1. Parse user request into doc targets (create_doc_target)
2. For each target:
   - Delegate research (delegate_research) → gets finding IDs
   - Delegate planning (delegate_planning) → gets plan ID
   - Delegate user interaction if approval needed (delegate_user_interaction)
   - Delegate writing (delegate_writing) → gets artifact IDs
   - Mark target complete (mark_target_complete)
3. When all targets are complete, call finish_session

# delegation

- delegate_research: finds and filters information, writes findings to blackboard
- delegate_planning: creates doc structure from findings, writes plan to blackboard
- delegate_writing: writes quality docs from plan, writes artifacts to blackboard
- delegate_user_interaction: formats info for user, gets approvals/feedback

# termination rules - MANDATORY

- After ALL doc targets reach status "complete", IMMEDIATELY call finish_session
- NEVER create new doc targets after the initial parse of the user request
- NEVER re-research a target that already has findings
- NEVER re-plan a target that already has a plan
- If plans exist and are approved, go straight to writing

# guidelines

- Check session status (check_session_status) for detailed state if needed
- Handle dependencies between doc targets
- Delegate to specialists - don't try to do their work
- Only see summaries and IDs - full content is in blackboard
- When all work is done, call finish_session with a summary`
}

/**
 * create the orchestrator agent that delegates to specialists
 */
export function createOrchestratorAgent(
  blackboard: Blackboard,
  context: OrchestratorContext,
  tools: {
    docTools: DocTools
    codebaseTools: Partial<CodebaseTools>
    interactionTools: InteractionTools
  },
  runtimeConfig: RuntimeConfig,
) {
  const systemPrompt = buildSystemPrompt(context)

  // create blackboard tools (shared across sub-agents)
  const blackboardTools = createBlackboardTools(blackboard)

  // create sub-agents with their specific tools
  const researchTools: ResearchAgentTools = {
    ...tools.docTools,
    ...tools.codebaseTools,
    ...blackboardTools,
  }
  const plannerTools: PlannerAgentTools = {
    ...tools.docTools,
    ...blackboardTools,
  }
  const writerTools: WriterAgentTools = {
    ...tools.docTools,
    ...tools.interactionTools,
    ...blackboardTools,
  }
  const userTools: UserAgentTools = {
    ...tools.interactionTools,
    ...blackboardTools,
  }

  // Create sub-agents with injected config
  const researchAgent = createResearchAgent(blackboard, researchTools, {
    maxRetries: runtimeConfig.agents.runtime.research.maxRetries,
    model: runtimeConfig.models.fast,
    providerOptions: runtimeConfig.agents.runtime.research.providerOptions,
  })
  const plannerAgent = createPlannerAgent(blackboard, plannerTools, {
    maxRetries: runtimeConfig.agents.runtime.planner.maxRetries,
    model: runtimeConfig.models.fast,
    providerOptions: runtimeConfig.agents.runtime.planner.providerOptions,
  })
  const writerAgent = createWriterAgent(blackboard, writerTools, {
    maxRetries: runtimeConfig.agents.runtime.writer.maxRetries,
    model: runtimeConfig.models.prose,
    providerOptions: runtimeConfig.agents.runtime.writer.providerOptions,
  })
  const userAgent = createUserAgent(blackboard, userTools, {
    maxRetries: runtimeConfig.agents.runtime.userInteraction.maxRetries,
    model: runtimeConfig.models.fast,
    providerOptions: runtimeConfig.agents.runtime.userInteraction.providerOptions,
  })

  const orchestratorTools = {
    ...createWorkflowTools(),

    // blackboard read-only for orchestrator
    blackboard_read_summary: {
      description: "read session summary from the blackboard",
      execute: () => blackboard.getSessionSummary(),
      inputSchema: z.object({}),
    },

    check_session_status: {
      description:
        "check the overall progress of all documentation targets in the current session",
      execute: () => blackboard.getSessionSummary(),
      inputSchema: z.object({}),
    },

    // session management tools
    create_doc_target: {
      description: "create a documentation target to track within a session",
      execute: ({
        name,
        description,
        priority,
      }: {
        name: string
        description: string
        priority?: "high" | "medium" | "low"
        dependsOn?: string[]
      }) => {
        const priorityMap = { high: 1, low: 3, medium: 2 }
        const targetPriority = priority ?? "medium"
        const id = blackboard.addDocTarget({
          description,
          name,
          priority: priorityMap[targetPriority],
          status: "pending",
        })

        return {
          docTargetId: id,
          message: `Created doc target '${name}' (${id})`,
          status: "created",
        }
      },
      inputSchema: z.object({
        dependsOn: z
          .array(z.string())
          .optional()
          .describe("ids of other doc targets this one depends on"),
        description: z.string(),
        name: z.string(),
        priority: z
          .enum(["high", "medium", "low"])
          .optional()
          .describe("priority level (defaults to 'medium' if not provided)"),
      }),
    },

    delegate_planning: {
      description:
        "delegate planning task to the planner agent for a specific doc target",
      execute: async ({ docTargetId }: { docTargetId: string }) => {
        blackboard.updateDocTargetStatus(docTargetId, "planning")

        const plannerResult = await plannerAgent.stream({
          prompt: `Create a documentation plan for target ID: ${docTargetId}.`,
        })

        await plannerResult.text

        const plan = blackboard.getLatestPlan(docTargetId)
        if (!plan) {
          throw new Error(`Planner failed to create a plan for ${docTargetId}`)
        }

        return {
          outlineSummary: plan.outline.sections.map((s) => s.title).join(", "),
          planId: plan.id,
          sectionCount: plan.outline.sections.length,
          status: plan.approved ? "approved" : "pending_approval",
          title: plan.title,
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
      }),
    },

    // delegation tools
    delegate_research: {
      description:
        "delegate research task to the research agent for a specific doc target",
      execute: async ({
        docTargetId,
        query,
        scope,
      }: {
        docTargetId: string
        query: string
        scope: "docs" | "code" | "both"
      }) => {
        blackboard.updateDocTargetStatus(docTargetId, "researching")

        const researchScope = scope || "both"

        const result = await researchAgent.stream({
          prompt: `Research for doc target ID ${docTargetId}: "${query}". Scope: ${researchScope}.`,
        })

        const text = await result.text

        const findingCount = blackboard.countFindingsForTarget(docTargetId)

        return {
          docTargetId,
          findingCount,
          summary: text || "research completed",
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
        query: z.string().describe("what information needs to be researched"),
        scope: z
          .enum(["docs", "code", "both"])
          .describe(
            "scope of research - use 'both' for comprehensive research",
          ),
      }),
    },

    delegate_user_interaction: {
      description: "delegate user interaction task to the user agent",
      execute: async ({
        type,
        planId,
        question,
        options,
      }: {
        type:
          | "approve_plan"
          | "ask_question"
          | "present_options"
          | "show_progress"
        planId?: string
        question?: string
        options?: string[]
      }) => {
        const payload = {
          options,
          planId,
          question,
          type,
        }

        const result = await userAgent.stream({
          prompt: JSON.stringify(payload),
        })
        const text = await result.text

        // if approving a plan, update the blackboard
        if (type === "approve_plan" && planId) {
          blackboard.approvePlan(planId)
        }

        return {
          result: text || "interaction completed",
          type,
        }
      },
      inputSchema: z.object({
        options: z.array(z.string()).optional(),
        planId: z.string().optional(),
        question: z.string().optional(),
        type: z.enum([
          "approve_plan",
          "ask_question",
          "present_options",
          "show_progress",
        ]),
      }),
    },

    delegate_writing: {
      description:
        "delegate writing task to the writer agent for specific sections or an entire plan",
      execute: async ({
        planId,
        sectionIds,
      }: {
        planId: string
        sectionIds?: string[]
      }) => {
        const plan = blackboard.getPlan(planId)
        if (!plan) {
          throw new Error(`Plan not found: ${planId}`)
        }

        blackboard.updateDocTargetStatus(plan.docTargetId, "writing")

        const prompt = `Write documentation for plan ID: ${planId}${
          sectionIds ? `, sections: ${sectionIds.join(", ")}` : ""
        }.`

        const result = await writerAgent.stream({ prompt })

        const text = await result.text

        const artifacts = blackboard.getArtifactsByPlanId(planId)

        return {
          artifactsCreated: artifacts.length,
          planId,
          summary: text || "writing completed",
        }
      },
      inputSchema: z.object({
        planId: z.string(),
        sectionIds: z
          .array(z.string())
          .optional()
          .describe(
            "specific section ids to write. if omitted, all pending sections will be written.",
          ),
      }),
    },

    finish_session: {
      description:
        "call this tool when ALL documentation work for the session is complete",
      execute: ({ summary }: { summary: string }) => ({
        sessionComplete: true,
        summary,
      }),
      inputSchema: z.object({
        summary: z
          .string()
          .describe("final summary of the documentation session"),
      }),
    },

    mark_target_complete: {
      description: "mark a specific documentation target as complete",
      execute: ({ docTargetId }: { docTargetId: string }) => {
        blackboard.updateDocTargetStatus(docTargetId, "complete")
        return {
          marked: true,
          message: `Doc target '${docTargetId}' marked as complete.`,
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
      }),
    },
  }

  const runtime = runtimeConfig.agents.runtime.orchestrator

  const agent = new ToolLoopAgent({
    instructions: systemPrompt,
    maxRetries: runtime.maxRetries,
    model: runtimeConfig.models.planning,

    prepareStep: ({ messages }) => {
      // inject current session state at every step so the orchestrator
      // can make informed decisions about what work to do
      const summary = blackboard.getSessionSummary()
      const stateContext = formatSessionContext(summary)

      // add warning signals based on state to prevent cycling
      let warningContext = ""
      if (summary.totalPlans > 0) {
        warningContext +=
          "\n⚠️ PLANS EXIST - do not create new doc targets or re-research"
      }
      if (
        summary.docTargets.length > 0 &&
        summary.docTargets.every((t) => t.status === "complete")
      ) {
        warningContext += "\n🛑 ALL TARGETS COMPLETE - call finish_session NOW"
      }

      const contextMessage = {
        content: `[SESSION STATE]\n${stateContext}${warningContext}\n[/SESSION STATE]`,
        role: "system" as const,
      }

      // keep messages manageable for long sessions while preserving context
      if (messages.length > 30) {
        const firstMessage = messages[0]
        if (!firstMessage) return { messages }

        return {
          messages: [firstMessage, contextMessage, ...messages.slice(-20)],
        }
      }

      // inject state after system prompt
      const firstMessage = messages[0]
      if (!firstMessage) return { messages }

      return {
        messages: [firstMessage, contextMessage, ...messages.slice(1)],
      }
    },
    providerOptions: runtime.providerOptions,

    stopWhen: [hasToolCall("finish_session"), stepCountIs(30)],
    tools: orchestratorTools as unknown as ToolSet,
  })

  return agent
}
