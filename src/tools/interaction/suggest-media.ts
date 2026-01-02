import { z } from "zod"

const mediaSuggestionSchema = z.object({
  description: z
    .string()
    .describe(
      "what the media should show - be specific enough that someone could create it",
    ),
  location: z
    .string()
    .describe(
      "file path and section where media should go (e.g. 'docs/guides/setup.mdx#installation')",
    ),
  mediaType: z.enum(["screenshot", "diagram", "video", "gif", "illustration"]),
  priority: z.enum(["required", "recommended", "nice-to-have"]),
})

export type MediaSuggestion = z.infer<typeof mediaSuggestionSchema>

/**
 * in-memory store for media suggestions during a session
 * cleared when the server restarts
 */
const mediaSuggestions: MediaSuggestion[] = []

/**
 * get all accumulated media suggestions
 */
function _getMediaSuggestions(): readonly MediaSuggestion[] {
  return mediaSuggestions
}

/**
 * clear all media suggestions (e.g. at start of new task)
 */
function _clearMediaSuggestions(): void {
  mediaSuggestions.length = 0
}

/**
 * tool for suggesting where visual media would enhance documentation
 *
 * the ai can't generate images, but it can flag where screenshots, diagrams,
 * or videos would help. these suggestions are accumulated and shown to the
 * user at the end as a to-do list.
 */
export const createSuggestMediaTool = () => ({
  description:
    "suggest where an image, screenshot, diagram, or video would enhance the documentation. " +
    "use this when you identify a place where visual media would help readers understand better. " +
    "be specific about what the media should show.",
  execute: (input: MediaSuggestion) => {
    mediaSuggestions.push(input)

    return {
      message: `noted: ${input.mediaType} needed at ${input.location}`,
      success: true,
      totalSuggestions: mediaSuggestions.length,
    }
  },
  inputSchema: mediaSuggestionSchema,
})
