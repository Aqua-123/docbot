import { z } from "zod"
import type { Blackboard } from "../../blackboard"

export function createBlackboardArtifactsTools(blackboard: Blackboard) {
  return {
    blackboard_read_artifact: {
      description: "read a specific artifact by id from the blackboard",
      execute: ({ artifactId }: { artifactId: string }) => {
        const artifact = blackboard.getArtifact(artifactId)
        if (!artifact) {
          return { error: "artifact not found" }
        }
        return {
          content: artifact.content,
          filePath: artifact.filePath,
          id: artifact.id,
          status: artifact.status,
          type: artifact.type,
          version: artifact.version,
        }
      },
      inputSchema: z.object({
        artifactId: z.string(),
      }),
    },
    blackboard_write_artifact: {
      description:
        "write an artifact (draft or final content) to the blackboard",
      execute: ({
        planId,
        sectionId,
        type,
        content,
        filePath,
        status,
      }: {
        planId?: string
        sectionId?: string
        type: "draft" | "final" | "media_suggestion"
        content?: string
        filePath?: string
        status?: "draft" | "review" | "approved" | "written"
      }) => {
        const artifactId = blackboard.addArtifact({
          content,
          filePath,
          planId,
          sectionId,
          status: status || "draft",
          type,
          version: 1,
        })
        return {
          artifactId,
          status: status || "draft",
          type,
        }
      },
      inputSchema: z.object({
        content: z.string().optional(),
        filePath: z.string().optional(),
        planId: z.string().optional(),
        sectionId: z.string().optional(),
        status: z
          .enum(["draft", "review", "approved", "written"])
          .default("draft"),
        type: z.enum(["draft", "final", "media_suggestion"]),
      }),
    },
  }
}
