import { describe, expect, it, vi } from "vitest"
import type { Task } from "../src/domain/task"
import {
  startTask,
  resetStartingTasks,
  type StartTaskContext,
} from "../src/gui/run/start-task"

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Implement run",
    description: "Send this prompt",
    projectDirectory: "C:\\projects\\foreman",
    agent: "build",
    column: "ready",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function context(
  create: ReturnType<typeof vi.fn>,
  prompt: ReturnType<typeof vi.fn>,
  initial: Task[] = [],
) {
  const tasks: Task[] = [...initial]
  return {
    ctx: {
      servers: {
        get: () => ({
          client: {
            session: { create, prompt },
          },
        }),
      },
      stores: {
        tasks: {
          update: (mutate: (draft: Task[]) => void) => mutate(tasks),
        },
      },
      toasts: {
        error: vi.fn(),
        success: vi.fn(),
      },
    } as unknown as StartTaskContext,
    tasks,
  }
}

describe("startTask", () => {
  it("creates one session and sends the description", async () => {
    resetStartingTasks()
    const create = vi.fn().mockResolvedValue({ id: "ses-1" })
    const prompt = vi.fn().mockResolvedValue({})
    const input = task()
    const { ctx, tasks } = context(create, prompt, [input])
    const first = startTask(ctx, input, "todo")
    const second = startTask(ctx, input, "todo")
    const results = await Promise.all([first, second])

    expect(create).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses-1",
      text: "Send this prompt",
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].sessionID).toBe("ses-1")
    expect(tasks[0].column).toBe("doing")
    expect(results[0].kind).not.toBe("ignored")
  })

  it("falls back to the title when the description is empty", async () => {
    resetStartingTasks()
    const create = vi.fn().mockResolvedValue({ id: "ses-1" })
    const prompt = vi.fn().mockResolvedValue({})
    const input = task({ description: undefined })
    const { ctx } = context(create, prompt, [input])
    await startTask(ctx, input, "todo")
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses-1",
      text: "Implement run",
    })
  })

  it("restores the previous column when create fails", async () => {
    resetStartingTasks()
    const create = vi.fn().mockRejectedValue(new Error("Sidecar unavailable"))
    const prompt = vi.fn()
    const input = task()
    const { ctx, tasks } = context(create, prompt, [input])
    const result = await startTask(ctx, input, "todo")
    expect(result.kind).toBe("create-failed")
    expect(tasks).toHaveLength(1)
    expect(tasks[0].column).toBe("todo")
    expect(tasks[0].lastError).toContain("Sidecar unavailable")
  })

  it("keeps the created session when prompt fails", async () => {
    resetStartingTasks()
    const create = vi.fn().mockResolvedValue({ id: "ses-1" })
    const prompt = vi.fn().mockRejectedValue(new Error("Prompt rejected"))
    const input = task()
    const { ctx, tasks } = context(create, prompt, [input])
    const result = await startTask(ctx, input, "todo")
    expect(result.kind).toBe("prompt-failed")
    expect(tasks).toHaveLength(1)
    expect(tasks[0].sessionID).toBe("ses-1")
    expect(tasks[0].column).toBe("doing")
    expect(tasks[0].lastError).toContain("Prompt rejected")
  })

  it("does not resurrect a task deleted while create is in flight", async () => {
    resetStartingTasks()
    let resolveCreate!: (value: { id: string }) => void
    const create = vi.fn().mockImplementation(() => new Promise<{ id: string }>((resolve) => {
      resolveCreate = resolve
    }))
    const prompt = vi.fn().mockResolvedValue({})
    const input = task()
    const { ctx, tasks } = context(create, prompt, [input])

    const pending = startTask(ctx, input, "todo")
    tasks.splice(0, tasks.length)
    resolveCreate({ id: "ses-1" })
    await pending

    expect(tasks).toEqual([])
  })

  it("preserves a newer column change while create is in flight", async () => {
    resetStartingTasks()
    let resolveCreate!: (value: { id: string }) => void
    const create = vi.fn().mockImplementation(() => new Promise<{ id: string }>((resolve) => {
      resolveCreate = resolve
    }))
    const prompt = vi.fn().mockResolvedValue({})
    const input = task()
    const { ctx, tasks } = context(create, prompt, [input])

    const pending = startTask(ctx, input, "todo")
    tasks.splice(0, 1, { ...tasks[0], column: "todo" })
    resolveCreate({ id: "ses-1" })
    await pending

    expect(tasks[0].sessionID).toBe("ses-1")
    expect(tasks[0].column).toBe("todo")
  })
})
