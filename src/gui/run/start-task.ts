import { canStart } from "../../domain/start-guard"
import {
  markTaskStarted,
  markTaskStartFailed,
  type Task,
  type TaskColumn,
} from "../../domain/task"

export type StartTaskContext = {
  servers: {
    get(id: "sidecar"): {
      client: {
        session: {
          create(input: {
            title: string
            agent?: string
            model?: { providerID: string; id: string }
            location: { directory: string }
          }): Promise<{ id: string }>
          prompt(input: { sessionID: string; text: string }): Promise<unknown>
        }
      }
    } | undefined
  }
  stores: {
    tasks: {
      value?: readonly Task[]
      update(mutate: (draft: Task[]) => void): void
    }
  }
  toasts?: {
    error(message: string): void
    success(message: string): void
  }
  toast?: {
    show(options: { title: string; description?: string; variant?: "error" | "success" }): unknown
  }
}

export type StartTaskResult =
  | { kind: "started"; sessionID: string }
  | { kind: "prompt-failed"; sessionID: string; error: string }
  | { kind: "create-failed"; error: string }
  | { kind: "ignored"; reason: string }

const starting = new Set<string>()

export function resetStartingTasks() {
  starting.clear()
}

export function isStarting(taskID: string): boolean {
  return starting.has(taskID)
}

export function startTask(
  ctx: StartTaskContext,
  task: Task,
  previousColumn: TaskColumn,
): Promise<StartTaskResult> {
  return (async () => {
    const guard = canStart(task, starting)
    if (!guard.valid) {
      return { kind: "ignored", reason: guard.reason ?? "already-starting" }
    }

    starting.add(task.id)
    try {
      const server = ctx.servers.get("sidecar")
      if (!server) {
        throw new Error("OpenCode sidecar is unavailable")
      }

      const stored = ctx.stores.tasks.value?.find((item) => item.id === task.id)
      if (task.sessionID || stored?.sessionID) {
        return { kind: "ignored", reason: "session-linked" }
      }

      let created: { id: string }
      try {
        created = await server.client.session.create({
          title: task.title,
          agent: task.agent,
          model: task.model,
          location: { directory: task.projectDirectory },
        })
      } catch (error) {
        const message = readableError(error)
        ctx.stores.tasks.update((draft) => {
          const index = draft.findIndex((item) => item.id === task.id)
          if (index >= 0) {
            draft[index] = markTaskStartFailed(draft[index], previousColumn, message, Date.now())
          } else {
            draft.push(markTaskStartFailed(task, previousColumn, message, Date.now()))
          }
        })
        ctx.toast?.show({ title: "Failed to start task", description: message, variant: "error" })
        ctx.toasts?.error(message)
        return { kind: "create-failed", error: message }
      }

      const now = Date.now()
      ctx.stores.tasks.update((draft) => {
        const index = draft.findIndex((item) => item.id === task.id)
        if (index >= 0) {
          draft[index] = markTaskStarted(draft[index], created.id, now)
        } else {
          draft.push(markTaskStarted(task, created.id, now))
        }
      })

      try {
        await server.client.session.prompt({
          sessionID: created.id,
          text: task.description?.trim() || task.title,
        })
        ctx.toast?.show({ title: `Started ${task.title}`, variant: "success" })
        ctx.toasts?.success(`Started ${task.title}`)
        return { kind: "started", sessionID: created.id }
      } catch (error) {
        const message = readableError(error)
        ctx.stores.tasks.update((draft) => {
          const index = draft.findIndex((item) => item.id === task.id)
          if (index >= 0) {
            draft[index] = {
              ...draft[index],
              lastError: `Send prompt again: ${message}`,
              updatedAt: Date.now(),
            }
          }
        })
        ctx.toast?.show({ title: "Send prompt again", description: message, variant: "error" })
        ctx.toasts?.error(`Send prompt again: ${message}`)
        return { kind: "prompt-failed", sessionID: created.id, error: message }
      }
    } finally {
      starting.delete(task.id)
    }
  })()
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === "string" && error.trim()) return error.trim()
  return "Failed to start the task"
}
