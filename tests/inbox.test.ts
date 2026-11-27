import { describe, expect, it, vi } from "vitest"
import { InboxService } from "../src/application/inbox"
import type { Task } from "../src/domain/task"
import type { TaskRepository } from "../src/application/ports/repositories"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"

function fixture(options: { status?: "connected" | "stale" | "connecting" | "disconnected"; tasks?: Partial<Task>[] } = {}) {
  const tasks = (options.tasks ?? [{ id: "task-1", title: "Build feature", projectDirectory: "/work/demo", column: "doing", sessionID: "ses-1" }]).map((value) => ({
    id: "task-1", title: "Build feature", projectDirectory: "/work/demo", column: "doing", createdAt: 1, updatedAt: 1, ...value,
  })) as Task[]
  const repository = { list: () => tasks } as TaskRepository
  const permissions = [{ id: "perm-1", sessionId: "ses-1", title: "write file" }]
  const questions = [{ id: "form-1", sessionId: "ses-1", questions: [{ key: "choice", question: "Choose", options: ["A", "B"] }] }]
  const gateway = {
    listPendingPermissions: vi.fn(async (sessionId?: string) => sessionId === "ses-1" ? permissions : []),
    listPendingQuestions: vi.fn(async (sessionId?: string) => sessionId === "ses-1" ? questions : []),
    replyPermission: vi.fn(async () => undefined),
    replyQuestion: vi.fn(async () => undefined),
  } as unknown as OpenCodeGateway
  let status = options.status ?? "connected"
  const service = new InboxService({ tasks: repository, gateway: () => status === "connected" ? gateway : undefined, runtimeStatus: () => status })
  return { service, gateway, permissions, questions, setStatus: (value: typeof status) => { status = value } }
}

describe("InboxService", () => {
  it("derives actionable permissions and forms per linked task without persisting runtime payloads", async () => {
    const f = fixture()
    const items = await f.service.list()
    expect(items.map((item) => item.kind)).toEqual(["permission", "question"])
    expect(items[0]).toMatchObject({ task: { id: "task-1" }, sessionId: "ses-1", permission: { id: "perm-1" } })
    expect(items[1]).toMatchObject({ task: { id: "task-1" }, question: { id: "form-1" } })
  })

  it("surfaces failed, missing, and disconnected/stale linked sessions", async () => {
    const failed = fixture({ tasks: [
      { id: "failed", title: "Failed", projectDirectory: "/a", sessionID: "s1", lastError: "Provider rejected execution" },
      { id: "missing", title: "Missing", projectDirectory: "/b", sessionID: "s2", lastError: "The linked OpenCode session could not be found" },
    ] })
    expect((await failed.service.list()).map((item) => item.kind)).toEqual(["error", "missing-session"])
    const stale = fixture({ status: "stale" })
    expect(await stale.service.list()).toMatchObject([{ kind: "runtime-unavailable", sessionId: "ses-1" }])
    const offline = fixture({ status: "disconnected" })
    expect(await offline.service.list()).toMatchObject([{ kind: "runtime-unavailable", title: "Runtime is disconnected" }])
  })

  it("does not auto-resolve or auto-answer and sends only explicit permission decisions", async () => {
    const f = fixture()
    await f.service.list()
    expect(f.gateway.replyPermission).not.toHaveBeenCalled()
    await f.service.replyPermission("perm-1", "reject")
    expect(f.gateway.replyPermission).toHaveBeenCalledWith({ permissionId: "perm-1", response: "reject" })
  })

  it("requires a currently pending form and complete answers before sending", async () => {
    const f = fixture()
    await expect(f.service.replyQuestion("form-1", [])).rejects.toThrow("every requested question")
    await expect(f.service.replyQuestion("form-1", [["not-an-option"]])).rejects.toThrow("options supplied")
    await f.service.replyQuestion("form-1", [["A"]])
    expect(f.gateway.replyQuestion).toHaveBeenCalledWith({ requestId: "form-1", answers: [["A"]] })
  })

  it("refuses responses while disconnected or after an item is no longer pending", async () => {
    const f = fixture({ status: "disconnected" })
    await expect(f.service.replyPermission("perm-1", "once")).rejects.toThrow("Connect OpenCode")
    f.setStatus("connected")
    ;(f.gateway.listPendingPermissions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    await expect(f.service.replyPermission("perm-1", "once")).rejects.toThrow("no longer pending")
  })
})
