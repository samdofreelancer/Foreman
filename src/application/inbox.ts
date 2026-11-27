import type { Task } from "../domain/task"
import type { OpenCodeGateway, RuntimePermission, RuntimeQuestion } from "./ports/opencode-gateway"
import type { TaskRepository } from "./ports/repositories"

export type AttentionItem =
  | { id: string; kind: "permission"; task: Pick<Task, "id" | "title" | "projectDirectory">; sessionId: string; title: string; permission: RuntimePermission }
  | { id: string; kind: "question"; task: Pick<Task, "id" | "title" | "projectDirectory">; sessionId: string; title: string; question: RuntimeQuestion }
  | { id: string; kind: "error" | "missing-session" | "runtime-unavailable"; task: Pick<Task, "id" | "title" | "projectDirectory">; sessionId?: string; title: string; reason: string }

export class InboxService {
  constructor(private readonly dependencies: {
    tasks: TaskRepository
    gateway: () => OpenCodeGateway | undefined
    runtimeStatus: () => "connected" | "stale" | "connecting" | "disconnected"
  }) {}

  async list(): Promise<AttentionItem[]> {
    const tasks = this.dependencies.tasks.list()
    const gateway = this.dependencies.gateway()
    const status = this.dependencies.runtimeStatus()
    const items: AttentionItem[] = []
    for (const task of tasks) {
      const context = { id: task.id, title: task.title, projectDirectory: task.projectDirectory }
      if (task.startPending) items.push({ id: `start:${task.id}`, kind: "error", task: context, title: "Session start outcome is unknown", reason: "Inspect OpenCode and confirm whether a session was created before recovering this task." })
      if (task.initialPromptState === "failed") items.push({ id: `prompt:${task.id}`, kind: "error", task: context, sessionId: task.sessionID, title: "Initial prompt failed", reason: task.lastError ?? "Resend the initial prompt to the existing session." })
      if (task.lastError && task.initialPromptState !== "failed" && !task.startPending) {
        const missing = /session.*(deleted|could not be found|not found)|could not find linked/i.test(task.lastError)
        items.push({ id: `task-error:${task.id}`, kind: missing ? "missing-session" : "error", task: context, sessionId: task.sessionID, title: missing ? "Linked session is missing" : "Execution needs attention", reason: task.lastError })
      }
      if (!task.sessionID) continue
      if (!gateway || status !== "connected") {
        if (!task.lastError && task.initialPromptState !== "failed" && !task.startPending) items.push({ id: `runtime:${task.id}`, kind: "runtime-unavailable", task: context, sessionId: task.sessionID, title: status === "stale" ? "Runtime connection is stale" : "Runtime is disconnected", reason: "The task remains linked, but Foreman cannot verify or receive updates from this OpenCode session until it reconnects." })
        continue
      }
      const [permissions, questions] = await Promise.all([
        gateway.listPendingPermissions(task.sessionID),
        gateway.listPendingQuestions(task.sessionID),
      ])
      for (const permission of permissions) items.push({ id: `permission:${permission.id}`, kind: "permission", task: context, sessionId: task.sessionID, title: permission.title || "Permission decision required", permission })
      for (const question of questions) items.push({ id: `question:${question.id}`, kind: "question", task: context, sessionId: task.sessionID, title: "OpenCode needs your input", question })
    }
    return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.task.title.localeCompare(b.task.title))
  }

  async replyPermission(id: string, response: "once" | "always" | "reject"): Promise<void> {
    const gateway = this.requireGateway()
    const match = (await this.list()).find((item) => item.kind === "permission" && item.permission.id === id)
    if (!match || match.kind !== "permission") throw new Error("Permission request is no longer pending")
    await gateway.replyPermission({ permissionId: id, response })
  }

  async replyQuestion(id: string, answers: string[][]): Promise<void> {
    const gateway = this.requireGateway()
    const match = (await this.list()).find((item) => item.kind === "question" && item.question.id === id)
    if (!match || match.kind !== "question") throw new Error("Question is no longer pending")
    if (answers.length !== match.question.questions.length || answers.some((answer) => answer.length === 0 || answer.some((value) => value.length > 2_000))) throw new Error("Answers must provide a response for every requested question")
    if (match.question.questions.some((question, index) => question.options?.length && answers[index].some((answer) => !question.options!.includes(answer)))) throw new Error("Choose only from the options supplied by OpenCode")
    await gateway.replyQuestion({ requestId: id, answers })
  }

  private requireGateway() {
    const gateway = this.dependencies.gateway()
    if (!gateway || this.dependencies.runtimeStatus() !== "connected") throw new Error("Connect OpenCode before responding to Inbox items")
    return gateway
  }
}
