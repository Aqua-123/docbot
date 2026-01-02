import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import type { Phase } from "../types"

interface PhaseIndicatorProps {
  phase: Phase
  status: "idle" | "loading" | "streaming" | "error"
}

const PHASE_INFO: Record<Phase, { label: string; emoji: string }> = {
  analysis: { emoji: "🔍", label: "analyzing" },
  execution: { emoji: "⚡", label: "executing" },
  planning: { emoji: "📋", label: "planning" },
  review: { emoji: "✅", label: "reviewing" },
}

export function PhaseIndicator({ phase, status }: PhaseIndicatorProps) {
  const info = PHASE_INFO[phase]
  const isActive = status === "loading" || status === "streaming"

  return (
    <Box marginBottom={1}>
      <Text>
        {info.emoji}{" "}
        <Text bold color={isActive ? "cyan" : "gray"}>
          {info.label}
        </Text>
        {isActive && (
          <>
            {" "}
            <Spinner type="dots" />
          </>
        )}
        {status === "error" && <Text color="red"> (error)</Text>}
      </Text>
    </Box>
  )
}
