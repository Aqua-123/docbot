import { Box, Text } from "ink"

export interface FileChange {
  path: string
  type: "created" | "modified" | "deleted" | "moved"
  description?: string
  fromPath?: string // for moved files
}

interface ChangesSummaryProps {
  changes: FileChange[]
  title?: string
}

/**
 * display a summary of file changes made during execution
 */
export function ChangesSummary({
  changes,
  title = "changes made",
}: ChangesSummaryProps) {
  if (changes.length === 0) {
    return (
      <Box marginTop={1}>
        <Text dimColor>no changes made</Text>
      </Box>
    )
  }

  const created = changes.filter((c) => c.type === "created")
  const modified = changes.filter((c) => c.type === "modified")
  const deleted = changes.filter((c) => c.type === "deleted")
  const moved = changes.filter((c) => c.type === "moved")

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {created.length > 0 && <ChangeGroup changes={created} type="created" />}
        {modified.length > 0 && (
          <ChangeGroup changes={modified} type="modified" />
        )}
        {moved.length > 0 && <ChangeGroup changes={moved} type="moved" />}
        {deleted.length > 0 && <ChangeGroup changes={deleted} type="deleted" />}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {created.length} created, {modified.length} modified, {deleted.length}{" "}
          deleted
          {moved.length > 0 ? `, ${moved.length} moved` : ""}
        </Text>
      </Box>
    </Box>
  )
}

function ChangeGroup({
  type,
  changes,
}: {
  type: FileChange["type"]
  changes: FileChange[]
}) {
  const color = {
    created: "green",
    deleted: "red",
    modified: "yellow",
    moved: "blue",
  }[type] as "green" | "yellow" | "red" | "blue"

  const icon = {
    created: "+",
    deleted: "-",
    modified: "~",
    moved: "→",
  }[type]

  return (
    <Box flexDirection="column">
      {changes.map((change) => (
        <Box key={change.path}>
          <Text color={color}>{icon} </Text>
          <Text>{change.path}</Text>
          {change.fromPath && <Text dimColor> (from {change.fromPath})</Text>}
          {change.description && <Text dimColor> - {change.description}</Text>}
        </Box>
      ))}
    </Box>
  )
}
