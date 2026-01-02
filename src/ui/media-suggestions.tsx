import { Box, Text } from "ink"
import type { MediaSuggestion } from "../tools/interaction/suggest-media"

interface MediaSuggestionsProps {
  suggestions: readonly MediaSuggestion[]
}

/**
 * display media suggestions as a to-do list for the user
 */
export function MediaSuggestions({ suggestions }: MediaSuggestionsProps) {
  if (suggestions.length === 0) {
    return null
  }

  const byPriority = {
    "nice-to-have": suggestions.filter((s) => s.priority === "nice-to-have"),
    recommended: suggestions.filter((s) => s.priority === "recommended"),
    required: suggestions.filter((s) => s.priority === "required"),
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        media to-do list
      </Text>
      <Text dimColor>
        the following visual assets would improve the documentation:
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {byPriority.required.length > 0 && (
          <PriorityGroup
            priority="required"
            suggestions={byPriority.required}
          />
        )}
        {byPriority.recommended.length > 0 && (
          <PriorityGroup
            priority="recommended"
            suggestions={byPriority.recommended}
          />
        )}
        {byPriority["nice-to-have"].length > 0 && (
          <PriorityGroup
            priority="nice-to-have"
            suggestions={byPriority["nice-to-have"]}
          />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          total: {suggestions.length} media item
          {suggestions.length !== 1 ? "s" : ""} suggested
        </Text>
      </Box>
    </Box>
  )
}

function PriorityGroup({
  priority,
  suggestions,
}: {
  priority: MediaSuggestion["priority"]
  suggestions: MediaSuggestion[]
}) {
  const color = {
    "nice-to-have": "gray",
    recommended: "yellow",
    required: "red",
  }[priority] as "red" | "yellow" | "gray"

  const icon = {
    "nice-to-have": "·",
    recommended: "*",
    required: "!",
  }[priority]

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={color}>
        {priority} ({suggestions.length})
      </Text>
      {suggestions.map((s) => {
        const key = `${s.mediaType}-${s.location}-${s.priority}-${s.description}`
        return (
          <Box flexDirection="column" key={key} marginLeft={2}>
            <Box>
              <Text color={color}>{icon} </Text>
              <Text>[{s.mediaType}]</Text>
              <Text dimColor> at </Text>
              <Text>{s.location}</Text>
            </Box>
            <Box marginLeft={4}>
              <Text dimColor>{s.description}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
