import { Schema } from "effect"

export const TaskColumn = Schema.Literal("todo", "ready", "doing", "done")
export type TaskColumn = typeof TaskColumn.Type

export const TaskModel = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
})

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  projectDirectory: Schema.String,
  projectName: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(TaskModel),
  column: TaskColumn,
  sessionID: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
})
export type Task = typeof Task.Type

export type TaskInput = {
  title: string
  description?: string
  projectDirectory: string
  projectName?: string
  agent?: string
  model?: { providerID: string; id: string }
  column?: TaskColumn
}

export type TaskPatch = Partial<Omit<Task, "id" | "createdAt">>

export function validateTaskInput(input: TaskInput) {
  const title = input.title.trim()
  const projectDirectory = input.projectDirectory.trim()
  const titleError = title.length === 0
    ? "Title is required"
    : title.length > 200
      ? "Title must be 200 characters or fewer"
      : undefined
  const projectError = projectDirectory.length === 0
    ? "Project is required"
    : !isAbsolutePath(projectDirectory)
      ? "Project directory must be absolute"
      : undefined

  return {
    valid: !titleError && !projectError,
    titleError,
    projectError,
  }
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
}

export function createTask(input: TaskInput, now: number, id: string): Task {
  const validation = validateTaskInput(input)
  if (!validation.valid) {
    throw new Error(validation.titleError ?? validation.projectError)
  }
  return {
    id,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    projectDirectory: input.projectDirectory.trim(),
    projectName: input.projectName,
    agent: input.agent?.trim() || "build",
    model: input.model,
    column: input.column ?? "todo",
    createdAt: now,
    updatedAt: now,
  }
}

export function updateTask(existing: Task, patch: TaskPatch, now: number): Task {
  if (patch.column === "doing" && !existing.sessionID) {
    throw new Error("Doing is managed by runs")
  }
  const next = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
  }
  if (next.column === "done") {
    next.finishedAt = existing.finishedAt ?? now
  } else {
    next.finishedAt = undefined
  }
  return next
}

export function deleteTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id)
}
