import { createUpdateStatusTool } from "./status"

/**
 * create all workflow tools
 */
export function createWorkflowTools() {
  return {
    update_status: createUpdateStatusTool(),
  }
}

/** @public */
export type WorkflowTools = ReturnType<typeof createWorkflowTools>
