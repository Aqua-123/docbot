import { Box, Text, useInput } from "ink"
import { useState } from "react"

interface AskUserProps {
  question: string
  onAnswer: (answer: string) => void
  placeholder?: string
}

export function AskUser({ question, onAnswer, placeholder }: AskUserProps) {
  const [input, setInput] = useState("")

  useInput((char, key) => {
    if (key.return) {
      onAnswer(input || placeholder || "")
    } else if (key.backspace || key.delete) {
      setInput((i) => i.slice(0, -1))
    } else if (char && !key.ctrl && !key.meta) {
      setInput((i) => i + char)
    }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">
        {question}
      </Text>
      <Box marginTop={1}>
        <Text>&gt; </Text>
        <Text>{input}</Text>
        {!input && placeholder && <Text dimColor>{placeholder}</Text>}
        <Text color="cyan">▌</Text>
      </Box>
    </Box>
  )
}
