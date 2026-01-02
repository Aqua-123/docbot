import { Box, Text, useInput, useStdout } from "ink"
import { ScrollView, type ScrollViewRef } from "ink-scroll-view"
import Spinner from "ink-spinner"
import { useEffect, useRef } from "react"
import { AskUser } from "./ask-user"
import { PlanDisplay, type PlanDisplayData } from "./plan-display"
import { PresentOptions } from "./present-options"

/**
 * a single part of a message - follows AI SDK patterns
 * https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage.md
 */
export interface MessagePart {
  type: "text" | "step-start" | string // tool parts use "tool-{toolName}" format
  text?: string
  toolName?: string
  toolCallId?: string
  // tool input (when state is input-streaming or input-available)
  input?: Record<string, unknown>
  // tool output (when state is output-available)
  output?: unknown
  // tool error (when state is output-error)
  errorText?: string
  // tool approval (when state is approval-requested)
  approval?: { id: string }
  // tool state: input-streaming | input-available | output-available | output-error | approval-requested
  state?:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "approval-requested"
}

/**
 * a chat message with rich parts
 */
export interface RichMessage {
  role: "user" | "assistant" | "system"
  parts: MessagePart[]
  id?: string
}

interface ChatStreamProps {
  messages: RichMessage[]
  streamingContent?: string
  isStreaming?: boolean
  visibleMessages?: number
  maxHeight?: number
  onToolOutput?: (args: {
    toolCallId: string
    tool: string
    output: unknown
    state?: "output-available" | "output-error"
    errorText?: string
  }) => void
}

/**
 * display chat messages following AI SDK patterns
 * renders all messages with parts inline in order
 */
export function ChatStream({
  messages,
  maxHeight,
  onToolOutput,
}: ChatStreamProps) {
  const scrollRef = useRef<ScrollViewRef>(null)
  const { stdout } = useStdout()
  const autoScrollRef = useRef(true)
  const lastContentHeightRef = useRef(0)

  // handle terminal resizing
  useEffect(() => {
    const handleResize = () => {
      scrollRef.current?.remeasure()
    }
    stdout?.on("resize", handleResize)
    return () => {
      stdout?.off("resize", handleResize)
    }
  }, [stdout])

  // auto-scroll to bottom when new messages arrive
  const messageCount = messages.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: we intentionally trigger on messageCount changes
  useEffect(() => {
    if (autoScrollRef.current) {
      scrollRef.current?.scrollToBottom()
    }
  }, [messageCount])

  // auto-scroll when content height increases (catches streaming, tool updates, etc.)
  const handleContentHeightChange = (height: number) => {
    if (autoScrollRef.current && height > lastContentHeightRef.current) {
      scrollRef.current?.scrollToBottom()
    }
    lastContentHeightRef.current = height
  }

  // keyboard navigation for scrolling
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep scroll controls together
  useInput((input, key) => {
    if (!scrollRef.current) return

    if (key.upArrow || input === "k") {
      scrollRef.current.scrollBy(-1)
      autoScrollRef.current = false
    } else if (key.downArrow || input === "j") {
      scrollRef.current.scrollBy(1)
      // check if we're at the bottom
      const scrollOffset = scrollRef.current.getScrollOffset()
      const bottomOffset = scrollRef.current.getBottomOffset()
      if (scrollOffset >= bottomOffset - 1) {
        autoScrollRef.current = true
      }
    } else if (key.pageUp) {
      const height = scrollRef.current.getViewportHeight() || 1
      scrollRef.current.scrollBy(-height)
      autoScrollRef.current = false
    } else if (key.pageDown) {
      const height = scrollRef.current.getViewportHeight() || 1
      scrollRef.current.scrollBy(height)
      // check if we're at the bottom
      const scrollOffset = scrollRef.current.getScrollOffset()
      const bottomOffset = scrollRef.current.getBottomOffset()
      if (scrollOffset >= bottomOffset - 1) {
        autoScrollRef.current = true
      }
    }
  })

  return (
    <Box flexDirection="column" height={maxHeight} overflow="hidden">
      <ScrollView
        onContentHeightChange={handleContentHeightChange}
        ref={scrollRef}
      >
        {messages.map((message, idx) => (
          <MessageBubble
            key={message.id || `msg-${idx}`}
            message={message}
            onToolOutput={onToolOutput}
          />
        ))}
      </ScrollView>
    </Box>
  )
}

function MessageBubble({
  message,
  onToolOutput,
}: {
  message: RichMessage
  onToolOutput?: ChatStreamProps["onToolOutput"]
}) {
  if (message.role === "system") {
    return null
  }

  const isUser = message.role === "user"

  // check if message has any content
  const hasContent = message.parts.some(
    (p) =>
      (p.type === "text" && p.text?.trim()) ||
      p.type.startsWith("tool-") ||
      p.type === "step-start",
  )

  if (!hasContent) {
    return null
  }

  // track if we've shown a step boundary
  let lastWasStepStart = false

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={isUser ? "yellow" : "cyan"}>
        {isUser ? "you" : "assistant"}:
      </Text>

      <Box flexDirection="column" marginLeft={2}>
        {/* render parts in order - inline, fluid chat-like flow */}
        {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps part rendering together */}
        {message.parts.map((part, index) => {
          // step-start parts: show boundaries between tool call steps
          if (part.type === "step-start") {
            // only show separator if not the first part and previous wasn't also step-start
            if (index > 0 && !lastWasStepStart) {
              lastWasStepStart = true
              return (
                <Box key={`step-${message.id || index}-${index}`} marginY={0}>
                  <Text dimColor>─────────────────────</Text>
                </Box>
              )
            }
            lastWasStepStart = true
            return null
          }
          lastWasStepStart = false

          // text parts
          if (part.type === "text" && part.text?.trim()) {
            return (
              <Box key={`text-${message.id || index}-${index}`} marginY={0}>
                <Text wrap="wrap">{part.text}</Text>
              </Box>
            )
          }

          // tool parts - use AI SDK state-based rendering
          if (part.type.startsWith("tool-")) {
            return (
              <ToolPart
                key={part.toolCallId || `tool-${message.id || index}-${index}`}
                onToolOutput={onToolOutput}
                part={part}
                toolName={part.toolName || part.type.slice(5)}
              />
            )
          }

          return null
        })}
      </Box>
    </Box>
  )
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep tool rendering together
function ToolPart({
  part,
  toolName,
  onToolOutput,
}: {
  part: MessagePart
  toolName: string
  onToolOutput?: ChatStreamProps["onToolOutput"]
}) {
  const state = part.state

  // extract tool name from type if not provided (e.g., "tool-code_search" -> "code_search")
  const displayName = toolName.replace(/_/g, " ")

  // format input args for display
  const formatInput = (input: Record<string, unknown> | undefined): string => {
    if (!input) return ""
    const entries = Object.entries(input)
    if (entries.length === 0) return ""

    // show first arg inline, truncate if needed
    const [key, value] = entries[0]!
    const valueStr =
      typeof value === "string"
        ? value.length > 40
          ? `"${value.slice(0, 40)}..."`
          : `"${value}"`
        : JSON.stringify(value).slice(0, 40)

    if (entries.length === 1) {
      return `${key}: ${valueStr}`
    }

    return `${key}: ${valueStr}, +${entries.length - 1} more`
  }

  // format output for display (truncated)
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps output formatting rules together
  const formatOutput = (output: unknown, maxLen = 60): string => {
    if (output === null || output === undefined) return "done"

    if (typeof output === "string") {
      return output.length > maxLen ? `${output.slice(0, maxLen)}...` : output
    }

    if (typeof output === "object") {
      // common patterns
      if ("success" in output) {
        if ("message" in output) {
          const msg = String(output.message)
          return msg.length > maxLen ? `${msg.slice(0, maxLen)}...` : msg
        }
        if ("error" in output) {
          const err = String(output.error)
          return err.length > maxLen
            ? `error: ${err.slice(0, maxLen)}...`
            : `error: ${err}`
        }
        return output.success ? "success" : "failed"
      }

      if ("results" in output && Array.isArray(output.results)) {
        return `${output.results.length} results`
      }

      if ("count" in output) {
        return `${output.count} items`
      }

      // fallback: show first key-value
      const entries = Object.entries(output)
      if (entries.length === 0) return "done"

      const [key, value] = entries[0]!
      const valueStr =
        typeof value === "string"
          ? value.length > maxLen
            ? `${value.slice(0, maxLen)}...`
            : value
          : JSON.stringify(value).slice(0, maxLen)

      return `${key}: ${valueStr}`
    }

    const str = String(output)
    return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str
  }

  // format error text (truncated)
  const formatError = (errorText: string | undefined, maxLen = 60): string => {
    if (!errorText) return ""
    return errorText.length > maxLen
      ? `${errorText.slice(0, maxLen)}...`
      : errorText
  }

  // special inline renders for interactive tools
  if (
    toolName === "ask_user" &&
    state === "output-available" &&
    part.output &&
    typeof part.output === "object" &&
    (part.output as { status?: string }).status === "awaiting_user_response" &&
    part.toolCallId
  ) {
    const output = part.output as {
      question?: string
      defaultAnswer?: string | null
    }
    return (
      <Box flexDirection="column" marginY={0}>
        <AskUser
          onAnswer={(answer) =>
            onToolOutput?.({
              output: { answer, skipped: false },
              state: "output-available",
              tool: toolName,
              toolCallId: part.toolCallId as string,
            })
          }
          placeholder={output.defaultAnswer ?? undefined}
          question={output.question ?? "please provide input"}
        />
      </Box>
    )
  }

  if (
    toolName === "present_options" &&
    state === "output-available" &&
    part.output &&
    typeof part.output === "object" &&
    (part.output as { pending?: boolean }).pending &&
    part.toolCallId
  ) {
    const output = part.output as {
      question?: string
      options?: Array<{ value: string; label: string; description?: string }>
      allowMultiple?: boolean
    }
    return (
      <Box flexDirection="column" marginY={0}>
        <PresentOptions
          allowMultiple={output.allowMultiple ?? false}
          onSubmit={(selected) =>
            onToolOutput?.({
              output: { pending: false, selected, skipped: false },
              state: "output-available",
              tool: toolName,
              toolCallId: part.toolCallId as string,
            })
          }
          options={output.options ?? []}
          question={output.question ?? "choose an option"}
        />
      </Box>
    )
  }

  // plan display - uses input for full plan data, output has planId/title/sectionCount
  if (
    toolName === "blackboard_write_plan" &&
    (state === "output-available" || state === "input-available") &&
    part.input &&
    typeof part.input === "object"
  ) {
    const planData: PlanDisplayData = {
      approved: false,
      docTargetId: part.input.docTargetId as string,
      outline: part.input.outline as PlanDisplayData["outline"],
      title: part.input.title as string,
    }
    return (
      <Box flexDirection="column" marginY={0}>
        <PlanDisplay plan={planData} />
      </Box>
    )
  }

  // suggest_media - show inline card for media suggestions
  if (
    toolName === "suggest_media" &&
    state === "output-available" &&
    part.input &&
    typeof part.input === "object"
  ) {
    const media = part.input as {
      location?: string
      mediaType?: string
      description?: string
      priority?: string
    }
    const priorityColor = {
      "nice-to-have": "gray",
      recommended: "yellow",
      required: "red",
    }[media.priority ?? "nice-to-have"] as "red" | "yellow" | "gray"

    return (
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color={priorityColor}>◆ </Text>
          <Text bold>[{media.mediaType}]</Text>
          <Text dimColor> at </Text>
          <Text>{media.location}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>{media.description}</Text>
        </Box>
      </Box>
    )
  }

  // render based on state
  switch (state) {
    case "input-streaming":
    case "input-available":
      // tool input is being streamed or ready, waiting for execution
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text color="gray"> {displayName}</Text>
            {part.input && <Text dimColor> ({formatInput(part.input)})</Text>}
          </Box>
        </Box>
      )

    case "output-available": {
      // tool has completed successfully - show collapsed by default
      const outputStr = formatOutput(part.output)
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            <Text color="green">✓</Text>
            <Text color="gray"> {displayName}</Text>
            {part.input && <Text dimColor> ({formatInput(part.input)})</Text>}
            <Text dimColor> → {outputStr}</Text>
          </Box>
        </Box>
      )
    }

    case "output-error":
      // tool execution failed
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            <Text color="red">✗</Text>
            <Text color="gray"> {displayName}</Text>
            {part.input && <Text dimColor> ({formatInput(part.input)})</Text>}
          </Box>
          {part.errorText && (
            <Box marginLeft={2}>
              <Text color="red">error: {formatError(part.errorText)}</Text>
            </Box>
          )}
        </Box>
      )

    case "approval-requested":
      // tool needs user approval (human-in-the-loop)
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            <Text color="yellow">?</Text>
            <Text color="gray"> {displayName}</Text>
            {part.input && <Text dimColor> ({formatInput(part.input)})</Text>}
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>waiting for approval...</Text>
          </Box>
        </Box>
      )

    default: {
      // fallback: treat as running if no state
      const isRunning = !(part.output || part.errorText)
      const outputStr =
        part.output !== undefined ? formatOutput(part.output) : null
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            {isRunning ? (
              <Text color="cyan">
                <Spinner type="dots" />
              </Text>
            ) : (
              <Text color="green">✓</Text>
            )}
            <Text color="gray"> {displayName}</Text>
            {part.input && <Text dimColor> ({formatInput(part.input)})</Text>}
            {outputStr && <Text dimColor> → {outputStr}</Text>}
          </Box>
          {part.errorText && (
            <Box marginLeft={2}>
              <Text color="red">error: {formatError(part.errorText)}</Text>
            </Box>
          )}
        </Box>
      )
    }
  }
}
