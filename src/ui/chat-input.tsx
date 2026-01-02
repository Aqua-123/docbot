import { Box, Text, useInput } from "ink"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * persistent input field for typing messages at any time
 */
export function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = "type a message...",
  disabled = false,
}: ChatInputProps) {
  useInput(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps all shortcuts together
    (input, key) => {
      if (disabled) return

      if (key.return && key.shift) {
        onChange(`${value}\n`)
      } else if (key.return) {
        if (value.trim()) {
          onSubmit(value.trim())
          onChange("")
        }
      } else if (key.backspace || key.delete) {
        onChange(value.slice(0, -1))
      } else if (input && !key.ctrl && !key.meta) {
        onChange(`${value}${input}`)
      }
    },
    { isActive: !disabled },
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={disabled ? "gray" : "cyan"}>&gt; </Text>
        <Text color={disabled ? "gray" : "white"}>{value}</Text>
        {!(value || disabled) && <Text dimColor>{placeholder}</Text>}
        {!disabled && <Text color="cyan">|</Text>}
      </Box>
      {disabled && (
        <Text dimColor italic>
          waiting for response...
        </Text>
      )}
    </Box>
  )
}
