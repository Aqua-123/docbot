import { cors } from "@elysiajs/cors"
import { Elysia } from "elysia"
import { createTimer, logElysia } from "../logger"
import type { AppContext } from "./context"
import { createChatRoute } from "./routes/chat"
import { createPlanRoute } from "./routes/plan"

// track elysia app instance for graceful shutdown
// using a loose type because elysia's generic types are complex
let appInstance: { server?: { stop: () => void } | null } | null = null

/**
 * create the elysia server with all routes
 */
function createServer(ctx: AppContext) {
  return (
    new Elysia()
      .use(cors())

      // global request logging middleware
      .onRequest(({ request }) => {
        const url = new URL(request.url)
        logElysia("info", "incoming request", {
          contentLength: request.headers.get("content-length"),
          route: `${request.method} ${url.pathname}`,
        })
      })

      // global response logging
      .onAfterHandle(({ request, response }) => {
        const url = new URL(request.url)
        const status = response instanceof Response ? response.status : 200

        logElysia("info", "response sent", {
          contentType:
            response instanceof Response
              ? response.headers.get("content-type")
              : typeof response,
          route: `${request.method} ${url.pathname}`,
          status,
        })
      })

      // global error handling with full context
      .onError(({ error, request, code }) => {
        const url = new URL(request.url)

        logElysia("error", "request failed", {
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown error",
          route: `${request.method} ${url.pathname}`,
        })

        // return structured error response
        return {
          code,
          message: error instanceof Error ? error.message : "unknown error",
          status: "error",
          // only include stack in development
          ...(process.env.NODE_ENV !== "production" && error instanceof Error
            ? { stack: error.stack }
            : {}),
        }
      })

      .use(createChatRoute(ctx))
      .use(createPlanRoute(ctx))

      .get("/health", () => {
        logElysia("info", "health check")
        return { status: "ok", timestamp: new Date().toISOString() }
      })
  )
}

/**
 * gracefully shutdown the server
 */
function shutdownServer() {
  if (appInstance?.server) {
    logElysia("info", "shutting down server")
    appInstance.server.stop()
    appInstance = null
    logElysia("info", "server stopped")
  }
}

/**
 * start the server on the given port
 */
export function startServer(ctx: AppContext, port: number) {
  const timer = createTimer()

  logElysia("info", "starting docbot server", {
    codebasePaths: ctx.codebasePaths,
    docsPath: ctx.docsPath,
    interactive: ctx.interactive,
    port,
    qdrantUrl: ctx.qdrantUrl,
  })

  const app = createServer(ctx)

  // idleTimeout: 0 disables the idle timeout - required for long-running streaming
  // responses where sub-agents may take time to respond from AI models
  app.listen({ idleTimeout: 0, port })
  appInstance = app

  // register shutdown handlers
  const handleShutdown = (signal: string) => {
    logElysia("info", "received shutdown signal", { signal })
    shutdownServer()
    process.exit(0)
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"))
  process.on("SIGTERM", () => handleShutdown("SIGTERM"))

  logElysia("info", "docbot server running", {
    pid: process.pid,
    startupMs: timer.elapsed(),
    url: `http://localhost:${port}`,
  })

  return app
}
