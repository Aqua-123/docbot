export type LogLevel =
  | "tool"
  | "cmd"
  | "result"
  | "embed"
  | "qdrant"
  | "rerank"
  | "error"
  | "info"

export type LogCategory = "llm" | "elysia"

export interface LogEntry {
  category: LogCategory
  level: LogLevel
  message: string
  timestamp: number
  indent: number
}

type IncomingLog = {
  category?: LogCategory
  level: LogLevel
  message: string
  data?: Record<string, unknown>
  indent?: number
  timestamp?: number
}

export const LOG_COLORS: Record<LogLevel, string> = {
  cmd: "yellow",
  embed: "magenta",
  error: "red",
  info: "white",
  qdrant: "blue",
  rerank: "magenta",
  result: "green",
  tool: "cyan",
}

const ANSI_COLORS: Record<LogLevel, string> = {
  cmd: "\x1b[33m",
  embed: "\x1b[35m",
  error: "\x1b[31m",
  info: "\x1b[37m",
  qdrant: "\x1b[34m",
  rerank: "\x1b[35m",
  result: "\x1b[32m",
  tool: "\x1b[36m",
}

const RESET = "\x1b[0m"
const LOG_BUFFER_SIZE = 300
const logBuffer: LogEntry[] = []
const listeners: Set<(entry: LogEntry) => void> = new Set()

let verbose = false
let indentLevel = 0
let uiMode = false
const DEFAULT_LOG_SERVER_PORT = 7424
let logServerPort: number | null = null
let logServer: ReturnType<typeof Bun.serve> | null = null
const suppressedConsoleCategories = new Set<LogCategory>()

export function startLogServer(port = DEFAULT_LOG_SERVER_PORT): number {
  if (logServer) return logServerPort ?? port

  try {
    logServer = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url)
        if (request.method === "POST" && url.pathname === "/log") {
          try {
            const payload = (await request.json()) as
              | IncomingLog
              | IncomingLog[]
            const entries = Array.isArray(payload) ? payload : [payload]
            for (const entry of entries) {
              ingestLog(entry, true)
            }
            return new Response(JSON.stringify({ status: "ok" }), {
              headers: { "content-type": "application/json" },
              status: 200,
            })
          } catch {
            return new Response("bad request", { status: 400 })
          }
        }

        return new Response("ok", { status: 200 })
      },
      port,
    })
  } catch {
    logServerPort = port
    return port
  }

  logServerPort = logServer?.port ?? port
  return logServerPort ?? port
}

export function getLogBuffer(): readonly LogEntry[] {
  return logBuffer
}

export function subscribeToLogs(
  listener: (entry: LogEntry) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearLogs(category?: LogCategory) {
  if (category) {
    for (let i = logBuffer.length - 1; i >= 0; i--) {
      const entry = logBuffer[i]
      if (!entry) continue
      if (entry.category === category) logBuffer.splice(i, 1)
    }
  } else {
    logBuffer.length = 0
  }
  for (const listener of listeners) {
    listener({
      category: category ?? "llm",
      indent: 0,
      level: "info",
      message: "[logs cleared]",
      timestamp: Date.now(),
    })
  }
}

export function enableUiMode() {
  uiMode = true
}

export function setVerbose(enabled: boolean) {
  verbose = enabled
}

export function isVerbose() {
  return verbose
}

export function muteConsoleForCategory(category: LogCategory) {
  suppressedConsoleCategories.add(category)
}

function ingestLog(entry: IncomingLog, fromServer = false) {
  if (!verbose) return
  emitLog(entry, fromServer)
}

function addToBuffer(entry: LogEntry) {
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift()
  }
  for (const listener of listeners) listener(entry)
}

function emitLog(entry: IncomingLog, fromServer: boolean) {
  const category = entry.category ?? "llm"
  const indent = entry.indent ?? indentLevel
  const fullMessage = entry.data
    ? `${entry.message} ${formatParams(entry.data)}`
    : entry.message

  if (logServerPort && !fromServer) {
    void fetch(`http://127.0.0.1:${logServerPort}/log`, {
      body: JSON.stringify({
        category,
        data: entry.data,
        indent,
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp ?? Date.now(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => undefined)
    return
  }

  const logEntry: LogEntry = {
    category,
    indent,
    level: entry.level,
    message: fullMessage,
    timestamp: entry.timestamp ?? Date.now(),
  }

  addToBuffer(logEntry)

  if (!(uiMode || suppressedConsoleCategories.has(category))) {
    const color = ANSI_COLORS[entry.level]
    const tag = `[${entry.level}]`
    const indentStr = "  ".repeat(indent)
    process.stderr.write(`${indentStr}${color}${tag}${RESET} ${fullMessage}\n`)
  }
}

function formatValue(value: unknown, maxLength = 100): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"

  if (typeof value === "string") {
    if (value.length > maxLength) {
      return `"${value.slice(0, maxLength)}..."`
    }
    return `"${value}"`
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    if (value.length > 5) return `[${value.length} items]`
    return JSON.stringify(value)
  }

  if (typeof value === "object") {
    const str = JSON.stringify(value)
    if (str.length > maxLength) {
      return `${str.slice(0, maxLength)}...`
    }
    return str
  }

  return String(value)
}

function formatParams(params: Record<string, unknown>): string {
  const parts = Object.entries(params).map(
    ([key, value]) => `${key}: ${formatValue(value)}`,
  )
  return `{ ${parts.join(", ")} }`
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  ingestLog({ category: "llm", data, level, message })
}

export function logTool(name: string, params: Record<string, unknown>) {
  log("tool", name, params)
  indentLevel = Math.min(indentLevel + 1, 5) // cap at 5 to prevent infinite indentation
}

export function logToolResult(result: unknown, durationMs: number) {
  indentLevel = Math.max(0, indentLevel - 1)

  if (!verbose) return

  const resultStr =
    typeof result === "object" && result !== null
      ? formatValue(result)
      : String(result)

  log("result", `${resultStr} (${durationMs.toFixed(0)}ms)`)
}

export function logCmd(command: string) {
  log("cmd", command)
}

export function logEmbed(description: string, durationMs?: number) {
  const msg = durationMs
    ? `${description} (${durationMs.toFixed(0)}ms)`
    : description
  log("embed", msg)
}

function logQdrant(description: string, durationMs?: number) {
  const msg = durationMs
    ? `${description} (${durationMs.toFixed(0)}ms)`
    : description
  log("qdrant", msg)
}

export function logRerank(description: string, durationMs?: number) {
  const msg = durationMs
    ? `${description} (${durationMs.toFixed(0)}ms)`
    : description
  log("rerank", msg)
}

export function logError(message: string, error?: unknown) {
  const errorStr =
    error instanceof Error ? error.message : error ? String(error) : ""
  log("error", errorStr ? `${message}: ${errorStr}` : message)
}

export function logInfo(message: string) {
  log("info", message)
}

export function logElysia(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
) {
  ingestLog({ category: "elysia", data, level, message })
}

export async function timed<T>(
  level: LogLevel,
  description: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now()

  try {
    const result = await fn()
    const duration = performance.now() - start

    if (verbose) {
      const logFn =
        level === "embed"
          ? logEmbed
          : level === "qdrant"
            ? logQdrant
            : level === "rerank"
              ? logRerank
              : (msg: string) => log(level, msg)
      logFn(description, duration)
    }

    return result
  } catch (error) {
    const duration = performance.now() - start
    logError(`${description} failed after ${duration.toFixed(0)}ms`, error)
    throw error
  }
}

export function createTimer() {
  const start = Date.now()
  return {
    elapsed: () => Date.now() - start,
    log: (label: string) => {
      const ms = Date.now() - start
      logInfo(`${label} took ${ms}ms`)
      return ms
    },
  }
}
