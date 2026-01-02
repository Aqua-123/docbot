import { Box, Text, useInput } from "ink"
import { useEffect, useMemo, useState } from "react"
import {
  clearLogs,
  getLogBuffer,
  LOG_COLORS,
  type LogCategory,
  type LogEntry,
  type LogLevel,
  subscribeToLogs,
} from "../logger"

interface LogDisplayProps {
  visibleLines?: number
  maxHeight?: number
  hasActiveInput?: boolean
}

type InkColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"

function getColor(level: LogLevel): InkColor {
  return LOG_COLORS[level] as InkColor
}

/**
 * scrollable log display for side panel
 */
export function LogDisplay({
  visibleLines = 15,
  maxHeight,
  hasActiveInput = false,
}: LogDisplayProps) {
  const [logs, setLogs] = useState<LogEntry[]>(() => [...getLogBuffer()])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeTab, setActiveTab] = useState<LogCategory>("llm")

  // use maxHeight if provided, otherwise fall back to visibleLines
  const effectiveVisibleLines = maxHeight
    ? Math.max(1, maxHeight - 3)
    : visibleLines

  useEffect(() => {
    return subscribeToLogs((entry) => {
      setLogs((prev) => [...prev, entry])

      if (autoScroll) {
        setScrollOffset(0)
      }
    })
  }, [autoScroll])

  const tabbedLogs = useMemo(
    () => logs.filter((log) => log.category === activeTab),
    [logs, activeTab],
  )

  const counts = useMemo(() => {
    return logs.reduce(
      (acc, log) => {
        acc[log.category]++
        return acc
      },
      { elysia: 0, llm: 0 } as Record<LogCategory, number>,
    )
  }, [logs])

  // keyboard navigation (uses same keys as chat - they share focus)
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: input handling keeps all shortcuts together
  useInput((input, key) => {
    const maxOffset = Math.max(0, tabbedLogs.length - effectiveVisibleLines)

    // skip single-key shortcuts when user is typing
    if (!hasActiveInput) {
      if (input === "c" || input === "C") {
        clearLogs(activeTab)
        setLogs((prev) => prev.filter((log) => log.category !== activeTab))
        setScrollOffset(0)
        setAutoScroll(true)
        return
      }

      if (key.leftArrow) {
        setActiveTab((prev) => (prev === "llm" ? "elysia" : "llm"))
        setScrollOffset(0)
        setAutoScroll(true)
        return
      }

      if (key.rightArrow) {
        setActiveTab((prev) => (prev === "elysia" ? "llm" : "elysia"))
        setScrollOffset(0)
        setAutoScroll(true)
        return
      }
    }

    // use shift+arrows for logs to avoid conflict with chat scroll
    if (key.shift && key.upArrow) {
      setScrollOffset((prev) => Math.min(prev + 1, maxOffset))
      setAutoScroll(false)
    } else if (key.shift && key.downArrow) {
      setScrollOffset((prev) => {
        const next = Math.max(prev - 1, 0)
        if (next === 0) setAutoScroll(true)
        return next
      })
    } else if (key.shift && key.pageUp) {
      setScrollOffset((prev) =>
        Math.min(prev + effectiveVisibleLines, maxOffset),
      )
      setAutoScroll(false)
    } else if (key.shift && key.pageDown) {
      setScrollOffset((prev) => {
        const next = Math.max(prev - effectiveVisibleLines, 0)
        if (next === 0) setAutoScroll(true)
        return next
      })
    }
  })

  // calculate visible window
  const endIndex = tabbedLogs.length - scrollOffset
  const startIndex = Math.max(0, endIndex - effectiveVisibleLines)
  const visibleLogs = tabbedLogs.slice(startIndex, endIndex)

  const atBottom = scrollOffset === 0
  const atTop = scrollOffset >= tabbedLogs.length - effectiveVisibleLines

  return (
    <Box
      flexDirection="column"
      height={maxHeight}
      overflow="hidden"
      paddingX={1}
    >
      <Header
        activeTab={activeTab}
        atBottom={atBottom}
        atTop={atTop}
        counts={counts}
        scrollOffset={scrollOffset}
      />

      {/* log entries - scrollable container */}
      <Box flexDirection="column" flexGrow={1} marginTop={1} overflow="hidden">
        {tabbedLogs.length === 0 ? (
          <Text dimColor>no logs yet</Text>
        ) : (
          visibleLogs.map((entry, i) => (
            <Box flexWrap="wrap" key={`${entry.timestamp}-${i}`}>
              <Text>{"  ".repeat(entry.indent)}</Text>
              <Text color={getColor(entry.level)}>[{entry.level}]</Text>
              <Text> {truncateMessage(entry.message, 40)}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* scroll hint */}
      <Controls
        activeTab={activeTab}
        showScrollHint={tabbedLogs.length > effectiveVisibleLines}
      />
    </Box>
  )
}

function truncateMessage(message: string, maxLen: number): string {
  if (message.length <= maxLen) return message
  return `${message.slice(0, maxLen)}...`
}

interface HeaderProps {
  activeTab: LogCategory
  counts: Record<LogCategory, number>
  scrollOffset: number
  atTop: boolean
  atBottom: boolean
}

function Header({
  activeTab,
  counts,
  scrollOffset,
  atTop,
  atBottom,
}: HeaderProps) {
  const tabs: Array<{ key: LogCategory; label: string }> = [
    { key: "llm", label: "llm debug" },
    { key: "elysia", label: "elysia" },
  ]

  return (
    <Box>
      {tabs.map((tab, idx) => (
        <Box key={tab.key} marginRight={1}>
          <Text bold color={activeTab === tab.key ? "cyan" : "gray"}>
            [{tab.label} {counts[tab.key]}]
          </Text>
          {idx < tabs.length - 1 && <Text dimColor> </Text>}
        </Box>
      ))}
      <Text dimColor> logs</Text>
      {!atBottom && <Text dimColor> [{atTop ? "top" : scrollOffset}]</Text>}
    </Box>
  )
}

function Controls({
  showScrollHint,
  activeTab,
}: {
  showScrollHint: boolean
  activeTab: LogCategory
}) {
  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Text dimColor>←/→ tabs ({activeTab}) | shift+↑/↓ scroll | c clear</Text>
      {showScrollHint && <Text dimColor>scroll</Text>}
    </Box>
  )
}
