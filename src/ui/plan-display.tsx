import { Box, Text } from "ink"

export interface PlanDisplayData {
  id?: string
  docTargetId?: string
  title?: string
  outline?: {
    sections?: Array<{
      id?: string
      title: string
      description?: string
      findingIds?: string[]
      orderIndex?: number
    }>
  }
  approved?: boolean
}

export function PlanDisplay({ plan }: { plan: PlanDisplayData }) {
  const sections = plan.outline?.sections ?? []

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="magenta">
        plan: {plan.title ?? "untitled"}
      </Text>
      <Text dimColor>
        status: {plan.approved ? "approved" : "pending approval"}
      </Text>
      {plan.docTargetId && <Text dimColor>target: {plan.docTargetId}</Text>}

      {sections.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {sections
            .slice()
            .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
            .map((section) => (
              <Box
                flexDirection="column"
                key={section.id ?? section.title}
                marginBottom={1}
              >
                <Box>
                  <Text color="cyan">• </Text>
                  <Text>{section.title}</Text>
                </Box>
                {section.description && (
                  <Box marginLeft={2}>
                    <Text dimColor>{section.description}</Text>
                  </Box>
                )}
                {section.findingIds && section.findingIds.length > 0 && (
                  <Box marginLeft={2}>
                    <Text dimColor>
                      findings: {section.findingIds.join(", ")}
                    </Text>
                  </Box>
                )}
              </Box>
            ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>no sections yet</Text>
        </Box>
      )}
    </Box>
  )
}
