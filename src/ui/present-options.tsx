import { Box, Text, useInput } from "ink"
import { useMemo, useState } from "react"

interface PresentOptionsProps {
  question: string
  options: Array<{ value: string; label: string; description?: string }>
  allowMultiple: boolean
  onSubmit: (selected: string[]) => void
}

export function PresentOptions({
  question,
  options,
  allowMultiple,
  onSubmit,
}: PresentOptionsProps) {
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const visibleOptions = useMemo(
    () =>
      options.length === 0 ? [{ label: "no options", value: "" }] : options,
    [options],
  )

  const moveCursor = (delta: number) => {
    setCursor(
      (i) => (i + delta + visibleOptions.length) % visibleOptions.length,
    )
  }

  const toggleSelection = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(cursor)) {
        next.delete(cursor)
      } else {
        next.add(cursor)
      }
      return next
    })
  }

  const submitSelection = () => {
    if (visibleOptions.length === 0) {
      onSubmit([])
      return
    }
    if (allowMultiple) {
      const values =
        selected.size > 0
          ? Array.from(selected).map((i) => visibleOptions[i]!.value)
          : [visibleOptions[cursor]!.value]
      onSubmit(values)
    } else {
      onSubmit([visibleOptions[cursor]!.value])
    }
  }

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      moveCursor(-1)
      return
    }
    if (key.downArrow || input === "j") {
      moveCursor(1)
      return
    }
    if (key.return) {
      submitSelection()
      return
    }
    if (input === " " && allowMultiple && visibleOptions.length > 0) {
      toggleSelection()
    }
  })

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="yellow">
        {question}
      </Text>
      {allowMultiple && <Text dimColor>space to toggle, enter to submit</Text>}
      <Box flexDirection="column" marginTop={1}>
        {visibleOptions.map((opt, idx) => {
          const isCursor = idx === cursor
          const isSelected = selected.has(idx)
          return (
            <Box flexDirection="column" key={opt.value}>
              <Box>
                <Text color={isCursor ? "cyan" : "gray"}>
                  {isCursor ? ">" : " "}
                </Text>
                {allowMultiple && (
                  <Text color="magenta">{isSelected ? "[x] " : "[ ] "}</Text>
                )}
                <Text color={isCursor ? "cyan" : undefined}>{opt.label}</Text>
              </Box>
              {opt.description && (
                <Box marginLeft={allowMultiple ? 6 : 3}>
                  <Text dimColor>{opt.description}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
