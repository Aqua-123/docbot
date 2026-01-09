import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { createAgentUIStreamResponse } from "ai"
import { Elysia, t } from "elysia"
import { createOrchestratorAgent } from "../../agents/orchestrator"
import { Blackboard } from "../../blackboard"
import { logElysia } from "../../logger"
import { createCodebaseTools } from "../../tools/codebase"
import { createDocTools } from "../../tools/docs"
import { createInteractionTools } from "../../tools/interaction"
import type { AppContext } from "../context"

/**
 * chat route for streaming agent responses
 *
 * uses multi-agent orchestrator with blackboard for state management.
 * reuses the same blackboard (SQLite session) across requests when sessionId is provided.
 */
export function createChatRoute(ctx: AppContext) {
  const docTools = createDocTools(
    ctx.docsPath,
    ctx.docIndex,
    ctx.qdrantClient,
    ctx.runtimeConfig.qdrant.collections.docs.name,
  )
  const codebaseTools =
    ctx.codebasePaths.length > 0
      ? createCodebaseTools(ctx.codebasePaths, ctx.codeIndex)
      : {}
  const interactionTools = createInteractionTools(ctx.interactive)

  logElysia("info", "chat route initialized", {
    codebaseToolsCount: Object.keys(codebaseTools).length,
    docToolsCount: Object.keys(docTools).length,
    interactionToolsCount: Object.keys(interactionTools).length,
    route: "/api/chat",
  })

  return new Elysia().post(
    "/api/chat",
    async ({ body, query }) => {
      const { messages, sessionId: bodySessionId } = body
      const { sessionId: querySessionId } = query || {}

      // use provided session ID (from body or query) or generate new one
      const sessionId = bodySessionId || querySessionId || randomUUID()

      logElysia("info", "chat request", {
        isNewSession: !(bodySessionId || querySessionId),
        messageCount: messages.length,
        sessionId,
      })

      try {
        // create blackboard database in a sessions directory
        const sessionsDir = join(process.cwd(), ".docbot-sessions")
        await mkdir(sessionsDir, { recursive: true })
        const dbPath = join(sessionsDir, `${sessionId}.db`)

        // create blackboard instance for this session (reuses existing DB if present)
        const blackboard = new Blackboard(dbPath, sessionId)

        // create orchestrator with blackboard, tools, and runtime config
        const orchestrator = createOrchestratorAgent(
          blackboard,
          {
            codebasePaths: ctx.codebasePaths,
            docsPath: ctx.docsPath,
          },
          {
            codebaseTools,
            docTools,
            interactionTools,
          },
          ctx.runtimeConfig,
        )

        // use createAgentUIStreamResponse - handles validation + streaming
        return createAgentUIStreamResponse({
          agent: orchestrator,
          uiMessages: messages,
        })
      } catch (error) {
        logElysia("error", "chat stream failed", {
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown error",
        })

        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "stream failed",
          }),
          { headers: { "Content-Type": "application/json" }, status: 500 },
        )
      }
    },
    {
      body: t.Object({
        messages: t.Array(t.Any()),
        sessionId: t.Optional(t.String()),
      }),
    },
  )
}
