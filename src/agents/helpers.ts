import type { StopCondition, ToolSet } from "ai"

/**
 * create a stop condition that triggers when a specific tool is called
 */
export function hasToolCall(toolName: string): StopCondition<ToolSet> {
  return ({ steps }) => {
    // check the last step for the tool call
    const lastStep = steps.at(-1)
    if (!lastStep?.toolCalls) return false

    return lastStep.toolCalls.some((call) => call.toolName === toolName)
  }
}
