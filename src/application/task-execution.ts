import { createActivityEvent } from "../domain/activity"
import { applyRuntimeCompletion, markFollowUpQueued } from "../domain/task"
import type { TaskRepository, ActivityRepository, TransactionRunner } from "./ports/repositories"
import type { OpenCodeGateway, RuntimeEvent, RuntimeSession } from "./ports/opencode-gateway"

export type ExecutionResult =
  | { kind: "started"; sessionId: string }
  | { kind: "prompt-failed"; sessionId: string; error: string }
  | { kind: "resent"; sessionId: string }
  | { kind: "followed-up"; sessionId: string }
  | { kind: "rejected"; reason: string }

export type TaskExecutionDependencies = {
  tasks: TaskRepository
  activities: ActivityRepository
  transaction: TransactionRunner["transaction"]
  gateway: () => OpenCodeGateway | undefined
  now?: () => number
  id?: () => string
}

/** Server-side execution orchestration. The browser never receives the OpenCode client. */
export class TaskExecutionService {
  private readonly now: () => number
  private readonly id: () => string

  constructor(private readonly dependencies: TaskExecutionDependencies) {
    this.now = dependencies.now ?? Date.now
    this.id = dependencies.id ?? (() => crypto.randomUUID())
  }

  async start(taskId: string): Promise<ExecutionResult> {
    const task = this.dependencies.tasks.getById(taskId)
    if (!task) return { kind: "rejected", reason: "Task not found" }
    if (task.sessionID) return { kind: "rejected", reason: "This task is already linked to an OpenCode session" }
    if (task.startPending) return { kind: "rejected", reason: "A previous start has an unknown outcome. Inspect OpenCode before attempting another start." }
    if (task.column !== "ready") return { kind: "rejected", reason: "Only Ready tasks can be started" }
    const gateway = this.dependencies.gateway()
    if (!gateway) return { kind: "rejected", reason: "OpenCode is disconnected. Connect a supported 2.4.x runtime first." }
    const health = await gateway.health()
    if (!health.connected) return { kind: "rejected", reason: health.reason ?? "OpenCode is unavailable or unsupported" }

    const claimToken = this.id()
    const claimed = this.dependencies.transaction(() => this.dependencies.tasks.claimStart(task.id, claimToken, this.now()))
    if (!claimed) {
      const current = this.dependencies.tasks.getById(task.id)
      return { kind: "rejected", reason: current?.sessionID ? "This task is already linked to an OpenCode session" : "A start request is already in progress for this task" }
    }

    let sessionId: string
    try {
      const session = await gateway.createSession({
        directory: task.projectDirectory,
        title: task.title,
        agent: task.agent,
        model: task.model,
      })
      sessionId = session.id
      if (!this.dependencies.tasks.claimSession(task.id, sessionId, this.now(), claimToken)) {
        return { kind: "rejected", reason: "OpenCode created a session, but the task could not claim it. Inspect OpenCode before retrying." }
      }
    } catch (error) {
      const message = safeError(error)
      if (isDefinitiveCreateFailure(error)) {
        this.dependencies.tasks.releaseStart(task.id, claimToken, message, this.now())
        this.record(task.id, "task.execution.start-failed", `Could not create an OpenCode session: ${message}`)
        return { kind: "rejected", reason: message }
      }
      this.record(task.id, "task.execution.start-unknown", "OpenCode session creation returned an uncertain result. Inspect OpenCode before retrying to avoid duplicate sessions.")
      return { kind: "rejected", reason: "OpenCode did not confirm whether a session was created. The task is locked against duplicate starts; inspect OpenCode before retrying." }
    }

    const prompt = task.description?.trim() || task.title
    try {
      await gateway.sendPrompt({ sessionId, text: prompt })
      this.dependencies.transaction(() => this.dependencies.tasks.setInitialPromptState(task.id, "sent", undefined, this.now()))
      this.record(task.id, "task.execution.started", `Started OpenCode session for: ${task.title}`)
      return { kind: "started", sessionId }
    } catch (error) {
      const message = safeError(error)
      this.dependencies.transaction(() => this.dependencies.tasks.setInitialPromptState(task.id, "failed", message, this.now()))
      this.record(task.id, "task.execution.prompt-failed", `Session created; initial prompt needs to be resent: ${message}`)
      return { kind: "prompt-failed", sessionId, error: message }
    }
  }

  async resendInitialPrompt(taskId: string): Promise<ExecutionResult> {
    const task = this.dependencies.tasks.getById(taskId)
    if (!task?.sessionID) return { kind: "rejected", reason: "This task has no linked OpenCode session" }
    if (task.initialPromptState !== "failed") return { kind: "rejected", reason: "The initial prompt is not in a failed state" }
    const gateway = this.dependencies.gateway()
    if (!gateway) return { kind: "rejected", reason: "OpenCode is disconnected; reconnect before resending" }
    const health = await gateway.health()
    if (!health.connected) return { kind: "rejected", reason: health.reason ?? "OpenCode is unavailable" }
    try {
      await gateway.sendPrompt({ sessionId: task.sessionID, text: task.description?.trim() || task.title })
      this.dependencies.transaction(() => this.dependencies.tasks.setInitialPromptState(task.id, "sent", undefined, this.now(), true))
      this.record(task.id, "task.execution.prompt-resent", `Resent the initial prompt in the existing session for: ${task.title}`)
      return { kind: "resent", sessionId: task.sessionID }
    } catch (error) {
      const message = safeError(error)
      this.dependencies.transaction(() => this.dependencies.tasks.setInitialPromptState(task.id, "failed", message, this.now()))
      return { kind: "prompt-failed", sessionId: task.sessionID, error: message }
    }
  }

  async followUp(taskId: string, text: string): Promise<ExecutionResult> {
    const task = this.dependencies.tasks.getById(taskId)
    if (!task?.sessionID) return { kind: "rejected", reason: "Start this task before sending a follow-up" }
    const message = text.trim()
    if (!message || message.length > 20_000) return { kind: "rejected", reason: "Follow-up must contain 1–20000 characters" }
    const gateway = this.dependencies.gateway()
    if (!gateway) return { kind: "rejected", reason: "OpenCode is disconnected; reconnect before sending a follow-up" }
    const health = await gateway.health()
    if (!health.connected) return { kind: "rejected", reason: health.reason ?? "OpenCode is unavailable" }
    const current = this.dependencies.tasks.getById(task.id)
    if (!current?.sessionID) return { kind: "rejected", reason: "The linked OpenCode session is no longer available" }
    this.dependencies.transaction(() => this.dependencies.tasks.update(markFollowUpQueued(current, this.now())))
    try {
      await gateway.sendFollowUp({ sessionId: current.sessionID, text: message })
      this.record(task.id, "task.execution.follow-up", `Sent a follow-up to the OpenCode session for: ${task.title}`)
      return { kind: "followed-up", sessionId: current.sessionID }
    } catch (error) {
      const failure = safeError(error)
      const latest = this.dependencies.tasks.getById(task.id)
      if (latest && !latest.lastError) {
        this.dependencies.transaction(() => this.dependencies.tasks.update({ ...latest, lastError: failure, updatedAt: this.now() }))
      }
      this.record(task.id, "task.execution.follow-up-failed", `Follow-up request failed: ${failure}`)
      return { kind: "rejected", reason: failure }
    }
  }

  async handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    const properties = event.properties ?? {}
    const sessionId = typeof properties.sessionID === "string" ? properties.sessionID
      : typeof properties.sessionId === "string" ? properties.sessionId : undefined
    if (!sessionId) return
    const task = this.dependencies.tasks.list().find((item) => item.sessionID === sessionId)
    if (!task) return
    const now = this.now()
    if (event.type === "session.execution.started") {
      this.record(task.id, "task.execution.running", `OpenCode is working on: ${task.title}`)
    } else if (event.type === "session.execution.succeeded") {
      this.dependencies.transaction(() => this.dependencies.tasks.update(applyRuntimeCompletion(task, "succeeded", undefined, now)))
      this.record(task.id, "task.execution.succeeded", `OpenCode completed: ${task.title}`)
    } else if (event.type === "session.execution.failed") {
      const error = eventError(properties.error)
      this.dependencies.transaction(() => this.dependencies.tasks.update(applyRuntimeCompletion(task, "failed", error, now)))
      this.record(task.id, "task.execution.failed", `OpenCode execution failed: ${error}`)
    } else if (event.type === "session.execution.interrupted") {
      const reason = typeof properties.reason === "string" ? properties.reason : "unknown"
      this.dependencies.transaction(() => this.dependencies.tasks.update(applyRuntimeCompletion(task, "interrupted", `Execution interrupted (${reason})`, now)))
      this.record(task.id, "task.execution.interrupted", `OpenCode execution interrupted (${reason}): ${task.title}`)
    } else if (event.type === "session.deleted") {
      this.dependencies.transaction(() => this.dependencies.tasks.update({ ...task, lastError: "The linked OpenCode session was deleted outside Foreman", updatedAt: now }))
      this.record(task.id, "task.execution.session-missing", `Linked OpenCode session was deleted: ${task.title}`)
    } else if (event.type === "session.idle") {
      this.record(task.id, "task.execution.idle", `OpenCode is idle in the linked session for: ${task.title}`)
    } else if (event.type === "permission.asked") {
      this.record(task.id, "task.execution.permission-needed", `OpenCode is waiting for a permission decision: ${task.title}`)
    } else if (event.type === "permission.replied") {
      this.record(task.id, "task.execution.permission-resolved", `A permission request was resolved in OpenCode: ${task.title}`)
    } else if (event.type === "form.created") {
      this.record(task.id, "task.execution.input-needed", `OpenCode is waiting for user input: ${task.title}`)
    } else if (event.type === "form.replied" || event.type === "form.cancelled") {
      this.record(task.id, "task.execution.input-updated", `An OpenCode input request was updated: ${task.title}`)
    }
  }

  async reconcileSession(sessionId: string, session: RuntimeSession | undefined): Promise<void> {
    const task = this.dependencies.tasks.list().find((item) => item.sessionID === sessionId)
    if (!task) return
    if (!session) {
      const now = this.now()
      this.dependencies.transaction(() => this.dependencies.tasks.update({ ...task, lastError: "The linked OpenCode session could not be found. The session link was retained.", updatedAt: now }))
      this.record(task.id, "task.execution.session-missing", `Could not find linked OpenCode session for: ${task.title}`)
      return
    }
    if (session.status === "success" || session.status === "succeeded") {
      const now = this.now()
      this.dependencies.transaction(() => this.dependencies.tasks.update(applyRuntimeCompletion(task, "succeeded", undefined, now)))
    } else if (session.status === "error" || session.status === "failed") {
      const now = this.now()
      this.dependencies.transaction(() => this.dependencies.tasks.update(applyRuntimeCompletion(task, "failed", "OpenCode reports that this session failed", now)))
    }
  }

  private record(taskId: string, type: string, summary: string) {
    const now = this.now()
    this.dependencies.transaction(() => this.dependencies.activities.append(createActivityEvent({ type, summary, taskId }, now, this.id())))
  }
}

function eventError(value: unknown): string {
  if (typeof value === "string") return redact(value).slice(0, 200)
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>
    for (const key of ["message", "name", "code"]) if (typeof candidate[key] === "string") return redact(candidate[key] as string).slice(0, 200)
  }
  return "OpenCode execution failed"
}

function redact(value: string) {
  return value.replace(/(authorization|password|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
}

function isDefinitiveCreateFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as { status?: unknown; statusCode?: unknown }
  const status = typeof value.status === "number" ? value.status : value.statusCode
  return typeof status === "number" && status >= 400 && status < 500
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "OpenCode request failed").replace(/(authorization|password|token)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 240)
}
