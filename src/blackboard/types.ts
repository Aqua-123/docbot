// blackboard types for multi-agent communication

export interface Finding {
  id: string
  sessionId: string
  docTargetId?: string
  type: "code" | "doc" | "api" | "concept"
  filePath?: string
  summary: string
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

export interface DocTarget {
  id: string
  sessionId: string
  name: string
  description?: string
  status: "pending" | "researching" | "planning" | "writing" | "complete"
  priority: number
}

export interface PlanOutline {
  sections: PlanSectionOutline[]
}

export interface PlanSectionOutline {
  id: string
  title: string
  description?: string
  findingIds: string[]
  orderIndex: number
}

export interface Plan {
  id: string
  sessionId: string
  docTargetId: string
  title: string
  outline: PlanOutline
  approved: boolean
  approvedAt?: Date
}

export interface Artifact {
  id: string
  sessionId: string
  planId?: string
  sectionId?: string
  type: "draft" | "final" | "media_suggestion"
  content?: string
  filePath?: string
  version: number
  status: "draft" | "review" | "approved" | "written"
}

export interface SessionSummary {
  sessionId: string
  docTargets: Array<{
    id: string
    name: string
    status: DocTarget["status"]
  }>
  totalFindings: number
  totalPlans: number
  totalArtifacts: number
  currentPhase: string
}
