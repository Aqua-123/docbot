import type { Blackboard } from "../../blackboard"
import { createBlackboardArtifactsTools } from "./artifacts"
import { createBlackboardCompletionTools } from "./completion"
import { createBlackboardFindingsTools } from "./findings"
import { createBlackboardPlansTools } from "./plans"

/**
 * create all blackboard tools for agents to interact with the shared state
 */
export function createBlackboardTools(blackboard: Blackboard) {
  return {
    ...createBlackboardFindingsTools(blackboard),
    ...createBlackboardPlansTools(blackboard),
    ...createBlackboardArtifactsTools(blackboard),
    ...createBlackboardCompletionTools(blackboard),
  }
}

/** @public */
export type BlackboardTools = ReturnType<typeof createBlackboardTools>
