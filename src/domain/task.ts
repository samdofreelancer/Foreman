import { Schema } from "effect"

export const TaskColumn = Schema.Literals(["todo", "ready", "doing", "done"])
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

export type TaskPatch = Partial<Omit<Task, "id" | "createdAt" | "updatedAt" | "sessionID">>

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
  if (!id.trim()) throw new Error("Task id is required")
  if (!Number.isFinite(now) || now < 0) throw new Error("Task timestamp must be a non-negative finite number")
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
  if (!Number.isFinite(now) || now < existing.updatedAt) {
    throw new Error("Task timestamp cannot move backwards")
  }
  if (patch.column === "doing" && !existing.sessionID) {
    throw new Error("Doing is managed by runs")
  }
  const next = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    sessionID: existing.sessionID,
    updatedAt: now,
  }
  const validation = validateTaskInput({ title: next.title, projectDirectory: next.projectDirectory })
  if (!validation.valid) throw new Error(validation.titleError ?? validation.projectError)
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

export function safeTaskArray(value: unknown): Task[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Task =>
    typeof item === "object"
    && item !== null
    && typeof (item as Record<string, unknown>).id === "string"
    && typeof (item as Record<string, unknown>).title === "string"
    && typeof (item as Record<string, unknown>).projectDirectory === "string"
    && ["todo", "ready", "doing", "done"].includes(
      String((item as Record<string, unknown>).column),
    )
    && typeof (item as Record<string, unknown>).createdAt === "number"
    && typeof (item as Record<string, unknown>).updatedAt === "number"
  )
}

export function markTaskStarted(task: Task, sessionID: string, now: number): Task {
  if (!sessionID.trim()) throw new Error("Session id is required")
  if (!Number.isFinite(now) || now < task.updatedAt) throw new Error("Task timestamp cannot move backwards")
  if (task.sessionID) return task
  return {
    ...task,
    sessionID,
    startedAt: now,
    column: "doing",
    updatedAt: now,
    lastError: undefined,
  }
}

export function markTaskStartFailed(
  task: Task,
  previousColumn: TaskColumn,
  error: string,
  now: number,
): Task {
  assertTaskTimestamp(task, now)
  return {
    ...task,
    column: previousColumn,
    lastError: error,
    updatedAt: now,
  }
}

export function setTaskFinished(task: Task, now: number): Task {
  assertTaskTimestamp(task, now)
  return {
    ...task,
    column: "done",
    finishedAt: task.finishedAt ?? now,
    updatedAt: now,
  }
}

export function clearTaskFinished(
  task: Task,
  column: "todo" | "ready",
  now: number,
): Task {
  assertTaskTimestamp(task, now)
  return {
    ...task,
    column,
    finishedAt: undefined,
    updatedAt: now,
  }
}

function assertTaskTimestamp(task: Task, now: number) {
  if (!Number.isFinite(now) || now < task.updatedAt) throw new Error("Task timestamp cannot move backwards")
}
