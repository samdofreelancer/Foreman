import type { TaskRepository } from "../../../application/ports/repositories"
import type { Task } from "../../../domain/task"
import { SqliteDatabase } from "./database"

type TaskRow = {
  id: string; title: string; description: string | null; project_directory: string
  project_name: string | null; agent: string | null; model_json: string | null
  column_name: Task["column"]; session_id: string | null; created_at: number; updated_at: number
  started_at: number | null; finished_at: number | null; last_error: string | null
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(task: Task) {
    this.database.connection.prepare(`INSERT INTO tasks (
      id, title, description, project_directory, project_name, agent, model_json,
      column_name, session_id, created_at, updated_at, started_at, finished_at, last_error
    ) VALUES (@id, @title, @description, @projectDirectory, @projectName, @agent, @model,
      @column, @sessionID, @createdAt, @updatedAt, @startedAt, @finishedAt, @lastError)`)
      .run(toTaskRow(task))
  }

  getById(id: string): Task | undefined {
    const row = this.database.connection.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
    return row ? fromTaskRow(row) : undefined
  }

  list(): Task[] {
    return (this.database.connection.prepare("SELECT * FROM tasks ORDER BY created_at, id").all() as TaskRow[]).map(fromTaskRow)
  }

  update(task: Task) {
    const existing = this.getById(task.id)
    if (!existing) throw new Error(`Task not found: ${task.id}`)
    if (existing.sessionID !== task.sessionID) throw new Error("A task's linked session id is immutable")
    if (task.updatedAt < existing.updatedAt) throw new Error("Task timestamp cannot move backwards")
    this.database.connection.prepare(`UPDATE tasks SET title=@title, description=@description,
      project_directory=@projectDirectory, project_name=@projectName, agent=@agent, model_json=@model,
      column_name=@column, updated_at=@updatedAt, started_at=@startedAt, finished_at=@finishedAt,
      last_error=@lastError WHERE id=@id`).run(toTaskRow(task))
  }

  delete(id: string): boolean {
    return this.database.connection.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes === 1
  }

  claimSession(taskId: string, sessionId: string, now: number): boolean {
    if (!sessionId.trim()) throw new Error("Session id is required")
    try {
      return this.database.connection.prepare(`UPDATE tasks SET session_id = ?, updated_at = ?
        WHERE id = ? AND session_id IS NULL AND updated_at <= ?`).run(sessionId, now, taskId, now).changes === 1
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") return false
      throw error
    }
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
  }
}
