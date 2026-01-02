import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nanoid } from "nanoid"
import type {
  Artifact,
  DocTarget,
  Finding,
  Plan,
  SessionSummary,
} from "./types"

type CountRow = { count: number }
type FindingRow = {
  approved_at?: string
  created_at: string
  doc_target_id: string | null
  file_path: string | null
  id: string
  metadata: string | null
  relevance_score: number | null
  session_id: string
  summary: string
  type: Finding["type"]
}

type DocTargetRow = {
  description: string | null
  id: string
  name: string
  priority: number
  session_id: string
  status: DocTarget["status"]
}

type PlanRow = {
  approved: number
  approved_at?: string
  created_at: string
  doc_target_id: string
  id: string
  outline: string
  session_id: string
  title: string
}

type ArtifactRow = {
  content: string | null
  created_at: string
  file_path: string | null
  id: string
  plan_id: string | null
  section_id: string | null
  session_id: string
  status: Artifact["status"]
  type: Artifact["type"]
  version: number
}

/**
 * create a temp database path for ephemeral session storage
 * uses the OS temp directory so sessions don't persist across runs
 */
function createTempDbPath(): string {
  const tempDir = process.env.TMPDIR ?? tmpdir()
  return join(tempDir, `docbot-session-${nanoid()}.db`)
}

export class Blackboard {
  private db: Database
  public readonly sessionId: string

  constructor(dbPath?: string, sessionId?: string) {
    this.db = new Database(dbPath ?? createTempDbPath())
    this.sessionId = sessionId || randomUUID()
    this.initSchema()
  }

  private initSchema(): void {
    // sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_request TEXT,
        current_phase TEXT DEFAULT 'research',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // doc_targets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_targets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // findings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        doc_target_id TEXT,
        type TEXT NOT NULL,
        file_path TEXT,
        summary TEXT NOT NULL,
        relevance_score REAL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (doc_target_id) REFERENCES doc_targets(id)
      )
    `)

    // plans table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        doc_target_id TEXT NOT NULL,
        title TEXT NOT NULL,
        outline TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        approved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (doc_target_id) REFERENCES doc_targets(id)
      )
    `)

    // artifacts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        plan_id TEXT,
        section_id TEXT,
        type TEXT NOT NULL,
        content TEXT,
        file_path TEXT,
        version INTEGER DEFAULT 1,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
      )
    `)

    // agent_logs table for debugging
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        action TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        tokens_used INTEGER,
        duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // ensure session exists
    const sessionExists = this.db
      .prepare("SELECT 1 FROM sessions WHERE id = ?")
      .get(this.sessionId)
    if (!sessionExists) {
      this.db
        .prepare("INSERT INTO sessions (id) VALUES (?)")
        .run(this.sessionId)
    }
  }

  // === Findings ===

  addFinding(finding: Omit<Finding, "id" | "sessionId">): string {
    const id = `finding-${randomUUID().slice(0, 8)}`
    this.db
      .prepare(
        `INSERT INTO findings (id, session_id, doc_target_id, type, file_path, summary, relevance_score, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.sessionId,
        finding.docTargetId || null,
        finding.type,
        finding.filePath || null,
        finding.summary,
        finding.relevanceScore || null,
        finding.metadata ? JSON.stringify(finding.metadata) : null,
      )
    return id
  }

  getFinding(id: string): Finding | null {
    const row = this.db
      .prepare("SELECT * FROM findings WHERE id = ?")
      .get(id) as FindingRow | undefined
    if (!row) return null
    return {
      docTargetId: row.doc_target_id || undefined,
      filePath: row.file_path || undefined,
      id: row.id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      relevanceScore: row.relevance_score || undefined,
      sessionId: row.session_id,
      summary: row.summary,
      type: row.type,
    }
  }

  getFindingsForTarget(docTargetId: string): Finding[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM findings WHERE doc_target_id = ? ORDER BY relevance_score DESC",
      )
      .all(docTargetId) as FindingRow[]
    return rows.map((row) => ({
      docTargetId: row.doc_target_id || undefined,
      filePath: row.file_path || undefined,
      id: row.id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      relevanceScore: row.relevance_score || undefined,
      sessionId: row.session_id,
      summary: row.summary,
      type: row.type,
    }))
  }

  countFindingsForTarget(docTargetId: string): number {
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM findings WHERE doc_target_id = ?")
      .get(docTargetId) as CountRow
    return result.count
  }

  // === Doc Targets ===

  addDocTarget(target: Omit<DocTarget, "id" | "sessionId">): string {
    const id = `target-${randomUUID().slice(0, 8)}`
    this.db
      .prepare(
        `INSERT INTO doc_targets (id, session_id, name, description, status, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.sessionId,
        target.name,
        target.description || null,
        target.status,
        target.priority,
      )
    return id
  }

  getDocTarget(id: string): DocTarget | null {
    const row = this.db
      .prepare("SELECT * FROM doc_targets WHERE id = ?")
      .get(id) as DocTargetRow | undefined
    if (!row) return null
    return {
      description: row.description || undefined,
      id: row.id,
      name: row.name,
      priority: row.priority,
      sessionId: row.session_id,
      status: row.status,
    }
  }

  getDocTargets(): DocTarget[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM doc_targets WHERE session_id = ? ORDER BY priority ASC",
      )
      .all(this.sessionId) as DocTargetRow[]
    return rows.map((row) => ({
      description: row.description || undefined,
      id: row.id,
      name: row.name,
      priority: row.priority,
      sessionId: row.session_id,
      status: row.status,
    }))
  }

  updateDocTargetStatus(id: string, status: DocTarget["status"]): void {
    this.db
      .prepare("UPDATE doc_targets SET status = ? WHERE id = ?")
      .run(status, id)
  }

  // === Plans ===

  addPlan(plan: Omit<Plan, "id" | "sessionId">): string {
    const id = `plan-${randomUUID().slice(0, 8)}`
    this.db
      .prepare(
        `INSERT INTO plans (id, session_id, doc_target_id, title, outline, approved)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.sessionId,
        plan.docTargetId,
        plan.title,
        JSON.stringify(plan.outline),
        plan.approved ? 1 : 0,
      )
    return id
  }

  getPlan(id: string): Plan | null {
    const row = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as
      | PlanRow
      | undefined
    if (!row) return null
    return {
      approved: !!row.approved,
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      docTargetId: row.doc_target_id,
      id: row.id,
      outline: JSON.parse(row.outline),
      sessionId: row.session_id,
      title: row.title,
    }
  }

  getLatestPlan(docTargetId: string): Plan | null {
    const row = this.db
      .prepare(
        "SELECT * FROM plans WHERE doc_target_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(docTargetId) as PlanRow | undefined
    if (!row) return null
    return {
      approved: !!row.approved,
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      docTargetId: row.doc_target_id,
      id: row.id,
      outline: JSON.parse(row.outline),
      sessionId: row.session_id,
      title: row.title,
    }
  }

  approvePlan(id: string): void {
    this.db
      .prepare(
        "UPDATE plans SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(id)
  }

  // === Artifacts ===

  addArtifact(artifact: Omit<Artifact, "id" | "sessionId">): string {
    const id = `artifact-${randomUUID().slice(0, 8)}`
    this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, plan_id, section_id, type, content, file_path, version, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.sessionId,
        artifact.planId || null,
        artifact.sectionId || null,
        artifact.type,
        artifact.content || null,
        artifact.filePath || null,
        artifact.version,
        artifact.status,
      )
    return id
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(id) as ArtifactRow | undefined
    if (!row) return null
    return {
      content: row.content || undefined,
      filePath: row.file_path || undefined,
      id: row.id,
      planId: row.plan_id || undefined,
      sectionId: row.section_id || undefined,
      sessionId: row.session_id,
      status: row.status,
      type: row.type,
      version: row.version,
    }
  }

  getArtifactsByPlanId(planId: string): Artifact[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE plan_id = ?")
      .all(planId) as ArtifactRow[]
    return rows.map((row) => ({
      content: row.content || undefined,
      filePath: row.file_path || undefined,
      id: row.id,
      planId: row.plan_id || undefined,
      sectionId: row.section_id || undefined,
      sessionId: row.session_id,
      status: row.status,
      type: row.type,
      version: row.version,
    }))
  }

  updateArtifact(
    id: string,
    updates: Partial<Pick<Artifact, "content" | "status" | "version">>,
  ): void {
    const sets: string[] = []
    const values: Array<string | number> = []
    if (updates.content !== undefined) {
      sets.push("content = ?")
      values.push(updates.content)
    }
    if (updates.status !== undefined) {
      sets.push("status = ?")
      values.push(updates.status)
    }
    if (updates.version !== undefined) {
      sets.push("version = ?")
      values.push(updates.version)
    }
    values.push(id)
    this.db
      .prepare(`UPDATE artifacts SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values)
  }

  // === Session Summary ===

  getSessionSummary(): SessionSummary {
    const targets = this.getDocTargets()
    const findingsResult = this.db
      .prepare("SELECT COUNT(*) as count FROM findings WHERE session_id = ?")
      .get(this.sessionId) as { count: number }
    const plansResult = this.db
      .prepare("SELECT COUNT(*) as count FROM plans WHERE session_id = ?")
      .get(this.sessionId) as { count: number }
    const artifactsResult = this.db
      .prepare("SELECT COUNT(*) as count FROM artifacts WHERE session_id = ?")
      .get(this.sessionId) as { count: number }

    return {
      currentPhase: this.determinePhase(targets),
      docTargets: targets.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
      })),
      sessionId: this.sessionId,
      totalArtifacts: artifactsResult.count,
      totalFindings: findingsResult.count,
      totalPlans: plansResult.count,
    }
  }

  private determinePhase(targets: DocTarget[]): string {
    if (targets.length === 0) return "pending"
    if (targets.every((t) => t.status === "complete")) return "complete"
    if (targets.some((t) => t.status === "writing")) return "writing"
    if (targets.some((t) => t.status === "planning")) return "planning"
    if (targets.some((t) => t.status === "researching")) return "research"
    return "pending"
  }

  close(): void {
    this.db.close()
  }
}
