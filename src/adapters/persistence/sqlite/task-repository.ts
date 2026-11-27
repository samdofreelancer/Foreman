import type { TaskRepository } from "../../../application/ports/repositories"
import type { Task } from "../../../domain/task"
import { SqliteDatabase } from "./database"

type TaskRow = {
  id: string; title: string; description: string | null; project_directory: string
  project_name: string | null; agent: string | null; model_json: string | null
  column_name: Task["column"]; session_id: string | null; created_at: number; updated_at: number
  started_at: number | null; finished_at: number | null; last_error: string | null
  initial_prompt_state: Task["initialPromptState"] | null
  start_pending: number
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(task: Task) {
    this.database.connection.prepare(`INSERT INTO tasks (
      id, title, description, project_directory, project_name, agent, model_json,
      column_name, session_id, created_at, updated_at, started_at, finished_at, last_error, initial_prompt_state
    ) VALUES (@id, @title, @description, @projectDirectory, @projectName, @agent, @model,
      @column, @sessionID, @createdAt, @updatedAt, @startedAt, @finishedAt, @lastError, @initialPromptState)`)
      .run(toTaskRow(task))
  }

  getById(id: string): Task | undefined {
    const row = this.database.connection.prepare(`SELECT tasks.*, EXISTS(SELECT 1 FROM task_start_claims WHERE task_id = tasks.id) AS start_pending
      FROM tasks WHERE tasks.id = ?`).get(id) as TaskRow | undefined
    return row ? fromTaskRow(row) : undefined
  }

  list(): Task[] {
    return (this.database.connection.prepare(`SELECT tasks.*, EXISTS(SELECT 1 FROM task_start_claims WHERE task_id = tasks.id) AS start_pending
      FROM tasks ORDER BY created_at, id`).all() as TaskRow[]).map(fromTaskRow)
  }

  update(task: Task) {
    const existing = this.getById(task.id)
    if (!existing) throw new Error(`Task not found: ${task.id}`)
    if (existing.sessionID !== task.sessionID) throw new Error("A task's linked session id is immutable")
    if (task.updatedAt < existing.updatedAt) throw new Error("Task timestamp cannot move backwards")
    this.database.connection.prepare(`UPDATE tasks SET title=@title, description=@description,
      project_directory=@projectDirectory, project_name=@projectName, agent=@agent, model_json=@model,
      column_name=@column, updated_at=@updatedAt, started_at=@startedAt, finished_at=@finishedAt,
      last_error=@lastError, initial_prompt_state=@initialPromptState WHERE id=@id`).run(toTaskRow(task))
  }

  delete(id: string): boolean {
    return this.database.connection.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes === 1
  }

  claimStart(taskId: string, claimToken: string, now: number): boolean {
    if (!claimToken.trim()) throw new Error("Start claim token is required")
    return this.database.connection.prepare(`INSERT INTO task_start_claims(task_id, claim_token, claimed_at)
      SELECT id, ?, ? FROM tasks WHERE id = ? AND column_name = 'ready' AND session_id IS NULL
      ON CONFLICT(task_id) DO NOTHING`).run(claimToken, now, taskId).changes === 1
  }

  releaseStart(taskId: string, claimToken: string, error: string, now: number): boolean {
    return this.database.transaction(() => {
      const claim = this.database.connection.prepare("SELECT 1 FROM task_start_claims WHERE task_id = ? AND claim_token = ?").get(taskId, claimToken)
      if (!claim) return false
      this.database.connection.prepare("UPDATE tasks SET last_error = ?, updated_at = MAX(updated_at, ?) WHERE id = ? AND session_id IS NULL")
        .run(error.slice(0, 500), now, taskId)
      this.database.connection.prepare("DELETE FROM task_start_claims WHERE task_id = ? AND claim_token = ?").run(taskId, claimToken)
      return true
    })
  }

  clearStartClaim(taskId: string): boolean {
    return this.database.connection.prepare(`DELETE FROM task_start_claims WHERE task_id = ?
      AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND session_id IS NULL)`).run(taskId, taskId).changes === 1
  }

  claimSession(taskId: string, sessionId: string, now: number, claimToken: string): boolean {
    if (!sessionId.trim()) throw new Error("Session id is required")
    if (!claimToken.trim()) throw new Error("Start claim token is required")
    try {
      return this.database.transaction(() => {
        const result = this.database.connection.prepare(`UPDATE tasks SET session_id = ?, column_name = 'doing', started_at = ?,
            updated_at = ?, initial_prompt_state = 'pending', last_error = NULL
          WHERE id = ? AND session_id IS NULL AND column_name = 'ready' AND updated_at <= ?
            AND EXISTS (SELECT 1 FROM task_start_claims WHERE task_id = ? AND claim_token = ?)`)
          .run(sessionId, now, now, taskId, now, taskId, claimToken)
        if (result.changes !== 1) return false
        this.database.connection.prepare("DELETE FROM task_start_claims WHERE task_id = ? AND claim_token = ?").run(taskId, claimToken)
        return true
      })
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") return false
      throw error
    }
  }

  setInitialPromptState(taskId: string, state: "pending" | "sent" | "failed", error: string | undefined, now: number, clearError = false) {
    const result = this.database.connection.prepare(`UPDATE tasks SET initial_prompt_state = ?,
      last_error = CASE WHEN ? THEN NULL WHEN ? IS NOT NULL THEN ? ELSE last_error END,
      updated_at = MAX(updated_at, ?) WHERE id = ? AND session_id IS NOT NULL`)
      .run(state, clearError ? 1 : 0, error?.slice(0, 500) ?? null, error?.slice(0, 500) ?? null, now, taskId)
    if (result.changes !== 1) throw new Error(`Linked task not found: ${taskId}`)
  }
}

function toTaskRow(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    projectDirectory: task.projectDirectory,
    projectName: task.projectName ?? null,
    agent: task.agent ?? null,
    model: task.model ? JSON.stringify(task.model) : null,
    column: task.column,
    sessionID: task.sessionID ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
    lastError: task.lastError ?? null,
    initialPromptState: task.initialPromptState ?? null,
  }
}

function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    projectDirectory: row.project_directory,
    projectName: row.project_name ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model_json ? JSON.parse(row.model_json) as Task["model"] : undefined,
    column: row.column_name,
    sessionID: row.session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    lastError: row.last_error ?? undefined,
    initialPromptState: row.initial_prompt_state ?? undefined,
    ...(row.start_pending === 1 ? { startPending: true } : {}),
  }
}
