import type { FetchFunction } from "@ai-sdk/provider-utils"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Box, Text, useApp, useInput, useStdout } from "ink"
import Spinner from "ink-spinner"
import { nanoid } from "nanoid"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isVerbose } from "../logger"
import type { MediaSuggestion } from "../tools/interaction/suggest-media"
import type { Phase } from "../types"
import type { FileChange } from "./changes-summary"
import { ChangesSummary } from "./changes-summary"
import { ChatInput } from "./chat-input"
import { ChatStream, type RichMessage } from "./chat-stream"
import { LogDisplay } from "./log-display"
import { MediaSuggestions } from "./media-suggestions"
import { PhaseIndicator } from "./phase-indicator"

interface AppProps {
  serverPort: number
  task?: string
  docsPath: string
  codebasePaths: string[]
  indexingStats?: IndexingStats
}

type AppStatus = "idle" | "streaming" | "awaiting-input" | "error"

interface IndexGroupStats {
  scanned: number
  added: number
  changed: number
  removed: number
  unchanged: number
  chunks?: number
}

interface IndexingStats {
  docs: IndexGroupStats
  code?: IndexGroupStats
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps app state handling together
export function App({
  serverPort,
  task,
  docsPath,
  codebasePaths,
  indexingStats,
}: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()

  const [error, setError] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(stdout.rows || 24)
  const [currentPhase, setCurrentPhase] = useState<Phase>("analysis")
  const [inputValue, setInputValue] = useState("")

  // generate session ID once on mount - persists across all requests
  const [sessionId] = useState(() => nanoid())

  // update terminal height on resize
  useEffect(() => {
    const handleResize = () => {
      setTerminalHeight(stdout.rows || 24)
    }

    // ink doesn't expose resize events directly, so poll or use stdout
    const interval = setInterval(handleResize, 100)
    return () => clearInterval(interval)
  }, [stdout])

  const baseUrl = `http://127.0.0.1:${serverPort}`

  // single unified transport with session ID in request body
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${baseUrl}/api/chat`,
        fetch: ((url, options) => {
          // inject session ID into request body
          if (options?.body && typeof options.body === "string") {
            try {
              const body = JSON.parse(options.body)
              body.sessionId = sessionId
              return fetch(url, {
                ...options,
                body: JSON.stringify(body),
                verbose: true,
              })
            } catch {
              // if body parsing fails, send as-is with sessionId in query or header
              // fallback: add sessionId as query param
              const urlWithSession = new URL(url.toString())
              urlWithSession.searchParams.set("sessionId", sessionId)
              return fetch(urlWithSession.toString(), {
                ...options,
                verbose: true,
              })
            }
          }
          // if no body, add sessionId as query param
          const urlWithSession = new URL(url.toString())
          urlWithSession.searchParams.set("sessionId", sessionId)
          return fetch(urlWithSession.toString(), {
            ...options,
            verbose: true,
          })
        }) as FetchFunction,
      }),

    [baseUrl, sessionId],
  )

  // unified chat instance
  const chat = useChat({
    onError: (err) => {
      console.error(err)
      setError(err.message)
      throw err
    },
    onFinish: () => {
      setIsComplete(true)
    },
    transport,
  })

  // derive app status
  const status: AppStatus =
    chat.status === "streaming" || chat.status === "submitted"
      ? "streaming"
      : error
        ? "error"
        : "idle"

  // start the task on mount (only if task is provided)
  const sendMessage = chat.sendMessage
  useEffect(() => {
    if (task) {
      sendMessage({
        parts: [{ text: task, type: "text" }],
        role: "user",
      })
    }
  }, [task, sendMessage])

  // handle user sending a message
  const handleUserMessage = useCallback(
    (text: string) => {
      setError(null)
      setIsComplete(false)
      chat.sendMessage({
        parts: [{ text, type: "text" }],
        role: "user",
      })
      setInputValue("")
    },
    [chat.sendMessage],
  )

  // keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit()
    }

    // ctrl+l to toggle logs (must be ctrl to avoid conflict with input field)
    if (key.ctrl && input === "l" && isVerbose()) {
      setShowLogs((prev) => !prev)
    }

    const hasInput = inputValue.trim().length > 0
    if (!hasInput && input === "q" && !key.ctrl && !key.meta) {
      exit()
    }
  })

  // convert messages to rich format with full parts for inline tool display
  // follows AI SDK patterns: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage.md
  const richMessages: RichMessage[] = chat.messages.map((m) => ({
    id: "id" in m ? (m.id as string) : undefined,
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep part shaping together
    parts: m.parts.map((p) => ({
      approval: "approval" in p ? (p.approval as { id: string }) : undefined,
      errorText: "errorText" in p ? (p.errorText as string) : undefined,
      // AI SDK tool part properties
      input: "input" in p ? (p.input as Record<string, unknown>) : undefined,
      output: "output" in p ? p.output : undefined,
      state:
        "state" in p
          ? (p.state as
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error"
              | "approval-requested")
          : undefined,
      text: "text" in p ? (p.text as string) : undefined,
      toolCallId: "toolCallId" in p ? (p.toolCallId as string) : undefined,
      toolName: "toolName" in p ? (p.toolName as string) : undefined,
      type: p.type as string,
    })),
    role: m.role as "user" | "assistant" | "system",
  }))

  // track phase from update_status tool calls
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep phase tracking together
  useEffect(() => {
    for (const message of richMessages) {
      if (message.role !== "assistant") continue

      for (const part of message.parts) {
        if (
          part.toolName === "update_status" &&
          part.state === "output-available" &&
          part.output &&
          typeof part.output === "object"
        ) {
          const result = part.output as { phase?: Phase }
          if (result.phase) {
            setCurrentPhase(result.phase)
          }
        }
      }
    }
  }, [richMessages])

  // show all messages (user and assistant) - following AI SDK pattern
  const displayMessages = richMessages.filter((m) => m.role !== "system")

  // count total tool calls across all messages (only count tools that are actually called, not results)
  const totalToolCalls = chat.messages.reduce((count, m) => {
    if (m.role !== "assistant") return count
    return (
      count +
      m.parts.filter(
        (p) =>
          (p.type.startsWith("tool-") &&
            "state" in p &&
            p.state !== "output-available" &&
            p.state !== "output-error") ||
          p.type === "tool-call" ||
          p.type === "tool-invocation",
      ).length
    )
  }, 0)

  // truncate task for display, or show idle message
  const truncatedTask = task
    ? task.length > 60
      ? `${task.slice(0, 60)}...`
      : task
    : "(waiting for input)"

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep aggregation logic together
  const derived = useMemo(() => {
    const changes: FileChange[] = []
    const media: MediaSuggestion[] = []
    let summary: string | null = null
    let awaitingInput = false

    for (const message of richMessages) {
      if (message.role !== "assistant") continue
      for (const part of message.parts) {
        if (part.state === "output-available") {
          const output = part.output as Record<string, unknown> | undefined

          if (
            part.toolName === "ask_user" &&
            output?.status === "awaiting_user_response"
          ) {
            awaitingInput = true
          }

          if (part.toolName === "present_options" && output?.pending) {
            awaitingInput = true
          }

          if (part.toolName === "suggest_media" && part.input) {
            media.push(part.input as MediaSuggestion)
          }

          if (
            part.toolName === "finish_session" &&
            typeof output?.summary === "string"
          ) {
            summary = output.summary
          }

          if (
            part.toolName === "create_doc" &&
            output?.success &&
            typeof output.path === "string"
          ) {
            changes.push({ path: output.path as string, type: "created" })
          } else if (
            part.toolName === "delete_doc" &&
            output?.success &&
            typeof output.path === "string"
          ) {
            changes.push({ path: output.path as string, type: "deleted" })
          } else if (
            output?.success &&
            (typeof output.path === "string" ||
              typeof output.targetPath === "string" ||
              typeof output.newPath === "string")
          ) {
            const path =
              (typeof output.path === "string" && output.path) ||
              (typeof output.targetPath === "string" && output.targetPath) ||
              (typeof output.newPath === "string" && output.newPath) ||
              "unknown"
            const fromPath =
              (typeof output.oldPath === "string" && output.oldPath) ||
              (typeof output.sourcePath === "string" && output.sourcePath) ||
              undefined
            const type = fromPath ? "moved" : "modified"
            changes.push({
              fromPath,
              path,
              type,
            })
          }
        }
      }
    }

    return {
      awaitingInput,
      fileChanges: changes,
      mediaSuggestions: media,
      sessionSummary: summary,
    }
  }, [richMessages])

  const hasPendingInput = derived.awaitingInput
  const computedStatus: AppStatus =
    status === "idle" && hasPendingInput ? "awaiting-input" : status

  // calculate content height dynamically based on terminal size
  // header: ~6 lines (title, task, codebase, status, error)
  // footer: 3 lines (input, hint, margin)
  // content: remaining space
  const headerHeight = error ? 7 : 6
  const footerHeight = 3
  const contentHeight = Math.max(
    10,
    terminalHeight - headerHeight - footerHeight - 2, // 2 for padding
  )

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {/* header - status bar */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold color="magenta">
            docbot
          </Text>
          <Text dimColor> - {docsPath}</Text>
        </Box>

        <Box marginTop={0}>
          <Text dimColor>task: </Text>
          <Text>{truncatedTask}</Text>
        </Box>

        {codebasePaths.length > 0 && (
          <Box>
            <Text dimColor>codebase: </Text>
            <Text dimColor>
              {codebasePaths.map((p) => p.split("/").pop()).join(", ")}
            </Text>
          </Box>
        )}

        {indexingStats && (
          <Box>
            <Text dimColor>index: </Text>
            <Text>
              docs {formatIndexGroup(indexingStats.docs)}
              {indexingStats.code
                ? ` | code ${formatIndexGroup(indexingStats.code)}`
                : ""}
            </Text>
          </Box>
        )}

        {/* phase indicator */}
        <Box marginTop={1}>
          <PhaseIndicator
            phase={currentPhase}
            status={
              computedStatus === "streaming"
                ? "streaming"
                : computedStatus === "error"
                  ? "error"
                  : computedStatus === "awaiting-input"
                    ? "idle"
                    : "idle"
            }
          />
        </Box>

        {/* status indicator */}
        <Box marginTop={0}>
          <StatusIndicator
            messageCount={chat.messages.length}
            status={computedStatus}
            toolCallCount={totalToolCalls}
          />
        </Box>
      </Box>

      {/* error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">error: {error}</Text>
        </Box>
      )}

      {/* main content area: chat (left) + logs (right) - fixed height, scrollable */}

      <Box flexDirection="row" flexGrow={1} height={contentHeight}>
        {/* chat panel */}
        <Box
          borderColor="gray"
          borderStyle="round"
          flexDirection="column"
          height={contentHeight}
          overflow="hidden"
          paddingX={1}
          width={showLogs ? "70%" : "100%"}
        >
          <ChatStream
            maxHeight={contentHeight - 2}
            messages={displayMessages}
            onToolOutput={(payload) => {
              if (payload.state === "output-error") {
                chat.addToolResult({
                  errorText: payload.errorText ?? "error",
                  state: "output-error",
                  tool: payload.tool,
                  toolCallId: payload.toolCallId,
                })
              } else {
                chat.addToolResult({
                  output: payload.output,
                  state:
                    payload.state === "output-available"
                      ? "output-available"
                      : undefined,
                  tool: payload.tool,
                  toolCallId: payload.toolCallId,
                })
              }
            }}
          />

          {/* accumulated artifacts - show progressively during streaming */}
          {derived.fileChanges.length > 0 && (
            <ChangesSummary changes={derived.fileChanges} />
          )}
          {derived.mediaSuggestions.length > 0 && (
            <MediaSuggestions suggestions={derived.mediaSuggestions} />
          )}
          {derived.sessionSummary && (
            <Box marginTop={1}>
              <Text dimColor>{derived.sessionSummary}</Text>
            </Box>
          )}
        </Box>

        {/* logs panel (right side) */}
        {showLogs && (
          <Box
            borderColor="gray"
            borderStyle="round"
            flexDirection="column"
            height={contentHeight}
            marginLeft={1}
            overflow="hidden"
            width="30%"
          >
            <LogDisplay
              hasActiveInput={inputValue.length > 0}
              maxHeight={contentHeight - 2}
            />
          </Box>
        )}
      </Box>

      {/* persistent input field */}
      <ChatInput
        disabled={
          computedStatus === "streaming" || computedStatus === "awaiting-input"
        }
        onChange={setInputValue}
        onSubmit={handleUserMessage}
        placeholder={
          isComplete ? "type to continue or adjust..." : "type a message..."
        }
        value={inputValue}
      />

      {/* footer */}
      <Box marginTop={1}>
        <Text dimColor>q to quit{isVerbose() && " | ctrl+l logs"}</Text>
      </Box>
    </Box>
  )
}

interface StatusIndicatorProps {
  status: AppStatus
  messageCount: number
  toolCallCount: number
}

function StatusIndicator({
  status,
  messageCount,
  toolCallCount,
}: StatusIndicatorProps) {
  const config = {
    "awaiting-input": {
      color: "yellow" as const,
      label: "waiting for your input",
    },
    error: { color: "red" as const, label: "error" },
    idle: { color: "gray" as const, label: "ready" },
    streaming: { color: "cyan" as const, label: "thinking" },
  }[status]

  const progress =
    messageCount > 0 || toolCallCount > 0
      ? ` (${messageCount} msg${messageCount !== 1 ? "s" : ""}, ${toolCallCount} tool${toolCallCount !== 1 ? "s" : ""})`
      : ""

  return (
    <Box>
      {status === "streaming" ? (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text color={config.color}>{">"}</Text>
      )}
      <Text color={config.color}>
        {" "}
        {config.label}
        {progress}
      </Text>
    </Box>
  )
}

function formatIndexGroup(group: IndexGroupStats) {
  const parts = [
    `${group.added} new`,
    `${group.changed} changed`,
    `${group.removed} removed`,
    `${group.scanned} scanned`,
  ]
  if (typeof group.chunks === "number") {
    parts.push(`${group.chunks} chunks`)
  }
  return parts.join(", ")
}
