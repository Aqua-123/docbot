import { z } from "zod"
import type { Blackboard } from "../../blackboard"
import type { Finding } from "../../blackboard/types"

export function createBlackboardFindingsTools(blackboard: Blackboard) {
  return {
    blackboard_read_finding: {
      description: "read a specific finding by id from the blackboard",
      execute: ({ findingId }: { findingId: string }) => {
        const finding = blackboard.getFinding(findingId)
        if (!finding) {
          return { error: "finding not found" }
        }
        return {
          filePath: finding.filePath,
          id: finding.id,
          metadata: finding.metadata,
          relevanceScore: finding.relevanceScore,
          summary: finding.summary,
          type: finding.type,
        }
      },
      inputSchema: z.object({
        findingId: z.string(),
      }),
    },

    blackboard_read_findings: {
      description:
        "read all findings for a documentation target from the blackboard",
      execute: ({ docTargetId }: { docTargetId: string }) => {
        const findings = blackboard.getFindingsForTarget(docTargetId)
        return {
          count: findings.length,
          findings: findings.map((f) => ({
            filePath: f.filePath,
            id: f.id,
            relevanceScore: f.relevanceScore,
            summary: f.summary,
            type: f.type,
          })),
        }
      },
      inputSchema: z.object({
        docTargetId: z.string(),
      }),
    },
    blackboard_write_finding: {
      description:
        "write a research finding to the blackboard. findings are summaries with file paths - not full content.",
      execute: ({
        docTargetId,
        type,
        filePath,
        summary,
        relevanceScore,
        metadata,
      }: {
        docTargetId?: string
        type: Finding["type"]
        filePath?: string
        summary: string
        relevanceScore?: number
        metadata?: Record<string, unknown>
      }) => {
        const id = blackboard.addFinding({
          docTargetId,
          filePath,
          metadata,
          relevanceScore,
          summary,
          type,
        })
        return {
          findingId: id,
          summary: "finding recorded",
        }
      },
      inputSchema: z.object({
        docTargetId: z.string().optional(),
        filePath: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        relevanceScore: z.number().min(0).max(1).optional(),
        summary: z.string(),
        type: z.enum(["code", "doc", "api", "concept"]),
      }),
    },
  }
}
