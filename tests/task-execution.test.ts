import { describe, expect, it, vi } from "vitest"
import { createTask, type Task } from "../src/domain/task"
import { TaskExecutionService } from "../src/application/task-execution"
import type { TaskRepository, ActivityRepository } from "../src/application/ports/repositories"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"
import type { ActivityEvent } from "../src/domain/activity"

function fixture(options: { connected?: boolean; create?: () => Promise<{ id: string }>; prompt?: () => Promise<void> } = {}) {
  const tasks = new Map<string, Task>([["task-1", createTask({
    title: "Build feature", description: "Implement the requested feature", projectDirectory: "C:\\work\\demo", column: "ready", agent: "build",
    model: { providerID: "test", id: "model-1" },
  }, 10, "task-1")]])
  const claims = new Map<string, string>()
  const events: ActivityEvent[] = []
  const taskRepository: TaskRepository = {
    create: (task) => { tasks.set(task.id, task) },
    getById: (id) => { const task = tasks.get(id); return task ? { ...task, ...(claims.has(id) ? { startPending: true } : {}) } : undefined },
    list: () => [...tasks.values()].map((task) => ({ ...task, ...(claims.has(task.id) ? { startPending: true } : {}) })),
    update: (task) => { tasks.set(task.id, task) },
    delete: (id) => tasks.delete(id),
    claimStart: (id, token) => {
      const task = tasks.get(id)
      if (!task || task.column !== "ready" || task.sessionID || claims.has(id)) return false
      claims.set(id, token); return true
    },
    releaseStart: (id, token, error, now) => {
      if (claims.get(id) !== token) return false
      claims.delete(id)
      const task = tasks.get(id)
      if (task) tasks.set(id, { ...task, lastError: error, updatedAt: now })
      return true
    },
    clearStartClaim: (id) => claims.delete(id),
    claimSession: (id, sessionId, now, token) => {
      const task = tasks.get(id)
      if (!task || task.sessionID || (token && claims.get(id) !== token)) return false
      claims.delete(id)
      tasks.set(id, { ...task, sessionID: sessionId, column: "doing", startedAt: now, updatedAt: now, initialPromptState: "pending" })
      return true
    },
    setInitialPromptState: (id, state, error, now, clearError) => {
      const task = tasks.get(id)
      if (!task?.sessionID) throw new Error("missing session")
      tasks.set(id, { ...task, initialPromptState: state, lastError: clearError ? undefined : error ?? task.lastError, updatedAt: now })
    },
  }
  const activityRepository: ActivityRepository = {
    append: (event) => events.push(event),
    listForTask: (id) => events.filter((event) => event.taskId === id),
    listRecent: () => events,
  }
  const createSession = vi.fn(options.create ?? (async () => ({ id: "ses-1" })))
  const sendPrompt = vi.fn(options.prompt ?? (async () => undefined))
  const sendFollowUp = vi.fn(async () => undefined)
  const gateway: OpenCodeGateway = {
    health: vi.fn(async () => ({ connected: options.connected ?? true, version: "2.4.2" })),
    listProjects: vi.fn(async () => []),
    createSession: createSession as never,
    sendPrompt: sendPrompt as never,
    sendFollowUp: sendFollowUp as never,
    interrupt: vi.fn(async () => undefined),
    readSession: vi.fn(async () => undefined),
    listPendingPermissions: vi.fn(async () => []),
    replyPermission: vi.fn(async () => undefined),
    listPendingQuestions: vi.fn(async () => []),
    replyQuestion: vi.fn(async () => undefined),
    subscribeEvents: vi.fn(() => (async function* () {})()),
  }
  let clock = 20
  let sequence = 0
  const service = new TaskExecutionService({
    tasks: taskRepository,
    activities: activityRepository,
    transaction: (operation) => operation(),
    gateway: () => options.connected === false ? undefined : gateway,
    now: () => clock++,
    id: () => `claim-${++sequence}`,
  })
  return { service, tasks, events, gateway, createSession, sendPrompt, sendFollowUp }
}

describe("TaskExecutionService", () => {
  it("creates one session with task agent/model, links it before the initial prompt", async () => {
    const f = fixture()
    const result = await f.service.start("task-1")
    expect(result).toEqual({ kind: "started", sessionId: "ses-1" })
    expect(f.createSession).toHaveBeenCalledWith({ directory: "C:\\work\\demo", title: "Build feature", agent: "build", model: { providerID: "test", id: "model-1" } })
    expect(f.sendPrompt).toHaveBeenCalledWith({ sessionId: "ses-1", text: "Implement the requested feature" })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "doing", sessionID: "ses-1", initialPromptState: "sent" })
    expect(f.events.map((event) => event.type)).toContain("task.execution.started")
  })

  it("allows only one of 20 concurrent start requests to create a session", async () => {
    let release!: (value: { id: string }) => void
    const f = fixture({ create: () => new Promise((resolve) => { release = resolve }) })
    const requests = Array.from({ length: 20 }, () => f.service.start("task-1"))
    await Promise.resolve()
    release({ id: "ses-unique" })
    const results = await Promise.all(requests)
    expect(f.createSession).toHaveBeenCalledTimes(1)
    expect(results.filter((result) => result.kind === "started")).toHaveLength(1)
    expect(f.tasks.get("task-1")?.sessionID).toBe("ses-unique")
  })

  it("rejects start while disconnected or for a non-Ready task", async () => {
    const offline = fixture({ connected: false })
    expect(await offline.service.start("task-1")).toMatchObject({ kind: "rejected", reason: expect.stringContaining("disconnected") })
    expect(offline.createSession).not.toHaveBeenCalled()
    const notReady = fixture()
    const task = notReady.tasks.get("task-1")!
    notReady.tasks.set("task-1", { ...task, column: "todo" })
    expect(await notReady.service.start("task-1")).toMatchObject({ kind: "rejected", reason: expect.stringContaining("Ready") })
  })

  it("releases the start claim when session creation fails", async () => {
    const create = vi.fn().mockRejectedValueOnce(Object.assign(new Error("invalid session request"), { status: 400 })).mockResolvedValue({ id: "ses-1" })
    const f = fixture({ create })
    expect(await f.service.start("task-1")).toMatchObject({ kind: "rejected", reason: "invalid session request" })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "ready", lastError: "invalid session request" })
    expect(await f.service.start("task-1")).toMatchObject({ kind: "started" })
    expect(f.createSession).toHaveBeenCalledTimes(2)
  })

  it("retains an atomic start claim when session creation has an ambiguous transport outcome", async () => {
    const f = fixture({ create: async () => { throw new Error("socket closed before response") } })
    expect(await f.service.start("task-1")).toMatchObject({ kind: "rejected", reason: expect.stringContaining("did not confirm") })
    expect(await f.service.start("task-1")).toMatchObject({ kind: "rejected", reason: expect.stringContaining("unknown outcome") })
    expect(f.createSession).toHaveBeenCalledTimes(1)
  })

  it("retains the session after prompt failure and resends into that same session", async () => {
    const f = fixture({ prompt: async () => { throw new Error("prompt rejected") } })
    const failed = await f.service.start("task-1")
    expect(failed).toMatchObject({ kind: "prompt-failed", sessionId: "ses-1" })
    expect(f.tasks.get("task-1")).toMatchObject({ sessionID: "ses-1", initialPromptState: "failed", column: "doing" })
    f.sendPrompt.mockResolvedValue(undefined)
    expect(await f.service.resendInitialPrompt("task-1")).toEqual({ kind: "resent", sessionId: "ses-1" })
    expect(f.createSession).toHaveBeenCalledTimes(1)
    expect(f.sendPrompt).toHaveBeenLastCalledWith({ sessionId: "ses-1", text: "Implement the requested feature" })
    expect(f.tasks.get("task-1")?.initialPromptState).toBe("sent")
  })

  it("sends follow-up only to the task-linked session and never creates another", async () => {
    const f = fixture()
    await f.service.start("task-1")
    expect(await f.service.followUp("task-1", "  Continue with tests  ")).toEqual({ kind: "followed-up", sessionId: "ses-1" })
    expect(f.sendFollowUp).toHaveBeenCalledWith({ sessionId: "ses-1", text: "Continue with tests" })
    expect(f.createSession).toHaveBeenCalledTimes(1)
  })

  it("reopens a completed task as Doing when a follow-up is queued into its existing session", async () => {
    const f = fixture()
    await f.service.start("task-1")
    await f.service.handleRuntimeEvent({ type: "session.execution.succeeded", properties: { sessionID: "ses-1" } })
    expect(f.tasks.get("task-1")?.column).toBe("done")
    expect(await f.service.followUp("task-1", "One more change")).toMatchObject({ kind: "followed-up", sessionId: "ses-1" })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "doing", sessionID: "ses-1", finishedAt: undefined })
    expect(f.createSession).toHaveBeenCalledTimes(1)
  })

  it("maps execution lifecycle events to runtime-owned task state and safe activity", async () => {
    const f = fixture()
    await f.service.start("task-1")
    await f.service.handleRuntimeEvent({ type: "session.execution.failed", properties: {
      sessionID: "ses-1", error: { message: "provider password=private-token failed" },
    } })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "doing", lastError: "provider password=[redacted] failed" })
    expect(f.events.at(-1)?.type).toBe("task.execution.failed")
    expect(f.events.at(-1)?.summary).not.toContain("private-token")
    await f.service.handleRuntimeEvent({ type: "session.execution.succeeded", properties: { sessionID: "ses-1" } })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "done", finishedAt: expect.any(Number), lastError: undefined })
  })

  it("does not erase an execution failure event that arrives before the prompt request resolves", async () => {
    const f = fixture()
    f.sendPrompt.mockImplementation(async () => {
      await f.service.handleRuntimeEvent({ type: "session.execution.failed", properties: { sessionID: "ses-1", error: { message: "Model rejected the run" } } })
    })
    await f.service.start("task-1")
    expect(f.tasks.get("task-1")).toMatchObject({ column: "doing", initialPromptState: "sent", lastError: "Model rejected the run" })
  })

  it("maps idle, permission, form and session-deletion events without persisting runtime payloads", async () => {
    const f = fixture()
    await f.service.start("task-1")
    for (const type of ["session.execution.started", "session.idle", "permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled", "session.deleted"]) {
      await f.service.handleRuntimeEvent({ type, properties: { sessionID: "ses-1", message: "private prompt content", permissionID: "perm-secret" } })
    }
    expect(f.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "task.execution.running", "task.execution.idle", "task.execution.permission-needed", "task.execution.permission-resolved",
      "task.execution.input-needed", "task.execution.input-updated", "task.execution.session-missing",
    ]))
    expect(JSON.stringify(f.events)).not.toContain("private prompt content")
    expect(JSON.stringify(f.events)).not.toContain("perm-secret")
  })

  it("reconciles linked sessions after reconnect and preserves missing-session links", async () => {
    const f = fixture()
    await f.service.start("task-1")
    await f.service.reconcileSession("ses-1", undefined)
    expect(f.tasks.get("task-1")).toMatchObject({ sessionID: "ses-1", lastError: expect.stringContaining("could not be found") })
    await f.service.reconcileSession("ses-1", { id: "ses-1", status: "success" })
    expect(f.tasks.get("task-1")).toMatchObject({ column: "done", sessionID: "ses-1", lastError: undefined })
  })

  it("does not send follow-up while disconnected or to a task without a session", async () => {
    const f = fixture({ connected: false })
    expect(await f.service.followUp("task-1", "Continue")).toMatchObject({ kind: "rejected" })
    expect(f.sendFollowUp).not.toHaveBeenCalled()
  })
})
