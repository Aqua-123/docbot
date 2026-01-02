import { createAskUserTool } from "./ask-user"
import { createPresentOptionsTool } from "./present-options"
import { createSuggestMediaTool, type MediaSuggestion } from "./suggest-media"

/**
 * create all interaction tools
 */
export function createInteractionTools(interactive: boolean) {
  return {
    ask_user: createAskUserTool(interactive),
    present_options: createPresentOptionsTool(interactive),
    suggest_media: createSuggestMediaTool(),
  }
}

export type InteractionTools = ReturnType<typeof createInteractionTools>

// re-export for convenience - these are used by the UI
export type { MediaSuggestion }
