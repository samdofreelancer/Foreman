import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteDatabase } from "../src/adapters/persistence/sqlite/database"
import { SqliteTaskRepository } from "../src/adapters/persistence/sqlite/task-repository"
import { SqliteProjectRepository } from "../src/adapters/persistence/sqlite/project-repository"
import { SqliteActivityRepository } from "../src/adapters/persistence/sqlite/activity-repository"
import { startForemanServer, type ForemanServer } from "../src/server/server"

const directories: string[] = []
const servers: ForemanServer[] = []
const databases: SqliteDatabase[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function workspace(options: { execution?: unknown; runtime?: unknown } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "foreman-api-"))
  directories.push(directory)
  const database = new SqliteDatabase(join(directory, "foreman.sqlite"))
  databases.push(database)
  const tasks = new SqliteTaskRepository(database)
  const server = await startForemanServer({ port: 0, logger: false, repositories: {
    tasks,
    projects: new SqliteProjectRepository(database),
    activities: new SqliteActivityRepository(database),
  }, execution: options.execution as never, runtime: options.runtime as never })
  servers.push(server)
  const session = await fetch(`${server.url}/api/session`)
  const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? ""
  const { csrfToken } = await session.json() as { csrfToken: string }
  const request = (path: string, method = "GET", body?: unknown) => fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { origin: server.url, cookie, "x-csrf-token": csrfToken }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { request, tasks }
}

describe("standalone workspace API", () => {
  it("creates tasks, auto-registers projects, updates status, and persists activity", async () => {
    const { request } = await workspace()
    const created = await request("/api/tasks", "POST", {
      title: "  Add API tests  ", description: "Cover task CRUD", projectDirectory: "C:/work/foreman",
    })
    expect(created.status).toBe(201)
    const { task } = await created.json() as { task: { id: string; title: string; column: string } }
    expect(task).toMatchObject({ title: "Add API tests", column: "todo" })
    expect(await (await request("/api/projects")).json()).toMatchObject({
      projects: [{ name: "foreman", directory: "C:/work/foreman" }],
    })
    const moved = await request(`/api/tasks/${task.id}`, "PATCH", { column: "ready" })
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({ task: { column: "ready" } })
    expect(await (await request("/api/activity")).json()).toMatchObject({ activities: [
      { type: "task.updated" }, { type: "task.created" },
    ] })
  })

  it("rejects invalid tasks and refuses manual transition into Doing", async () => {
    const { request } = await workspace()
    expect((await request("/api/tasks", "POST", { title: "", projectDirectory: "/work/a" })).status).toBe(400)
    const created = await request("/api/tasks", "POST", { title: "Valid", projectDirectory: "/work/a" })
    const { task } = await created.json() as { task: { id: string } }
    const doing = await request(`/api/tasks/${task.id}`, "PATCH", { column: "doing" })
    expect(doing.status).toBe(400)
    expect(await doing.json()).toMatchObject({ error: { code: "INVALID_TASK_UPDATE" } })
  })

  it("supports task detail and delete without deleting its audit history", async () => {
    const { request } = await workspace()
    const created = await request("/api/tasks", "POST", { title: "Delete me", projectDirectory: "/work/a" })
    const { task } = await created.json() as { task: { id: string } }
    expect((await request(`/api/tasks/${task.id}`)).status).toBe(200)
    expect((await request(`/api/tasks/${task.id}`, "DELETE")).status).toBe(204)
    expect((await request(`/api/tasks/${task.id}`)).status).toBe(404)
    expect(await (await request("/api/activity")).json()).toMatchObject({ activities: [
      { type: "task.deleted" }, { type: "task.created" },
    ] })
  })

  it("creates and updates manual projects with validated absolute directories", async () => {
    const { request } = await workspace()
    expect((await request("/api/projects", "POST", { name: "Bad path", directory: "relative/path" })).status).toBe(400)
    const created = await request("/api/projects", "POST", { name: "Tools", directory: "/work/tools" })
    expect(created.status).toBe(201)
    const { project } = await created.json() as { project: { id: string } }
    const updated = await request(`/api/projects/${project.id}`, "PATCH", { name: "Developer Tools" })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ project: { name: "Developer Tools", directory: "/work/tools" } })
  })

  it("exposes runtime connection and explicit task execution routes behind same-origin CSRF", async () => {
    let runtimeStatus: Record<string, unknown> = { status: "disconnected" }
    const runtime = {
      get status() { return runtimeStatus },
      connect: vi.fn(async () => { runtimeStatus = { status: "connected", mode: "managed", version: "2.4.2" }; return runtimeStatus }),
      disconnect: vi.fn(async () => { runtimeStatus = { status: "disconnected" } }),
      close: vi.fn(async () => undefined),
    }
    const execution = {
      start: vi.fn(async () => ({ kind: "started", sessionId: "ses-1" })),
      resendInitialPrompt: vi.fn(async () => ({ kind: "resent", sessionId: "ses-1" })),
      followUp: vi.fn(async (_id: string, text: string) => ({ kind: "followed-up", sessionId: "ses-1", text })),
    }
    const { request } = await workspace({ runtime, execution })
    expect(await (await request("/api/runtime")).json()).toMatchObject({ runtime: { status: "disconnected" } })
    expect((await request("/api/runtime/connect", "POST", { mode: "managed", executable: "opencode" })).status).toBe(200)
    expect(runtime.connect).toHaveBeenCalledWith({ mode: "managed", executable: "opencode" })
    const created = await request("/api/tasks", "POST", { title: "Execute", projectDirectory: "/work/a" })
    const { task } = await created.json() as { task: { id: string } }
    await request(`/api/tasks/${task.id}`, "PATCH", { column: "ready" })
    expect(await (await request(`/api/tasks/${task.id}/start`, "POST", {})).json()).toMatchObject({ result: { kind: "started", sessionId: "ses-1" } })
    expect(await (await request(`/api/tasks/${task.id}/resend`, "POST", {})).json()).toMatchObject({ result: { kind: "resent" } })
    expect(await (await request(`/api/tasks/${task.id}/follow-up`, "POST", { text: "Continue" })).json()).toMatchObject({ result: { kind: "followed-up", text: "Continue" } })
    expect((await request(`/api/tasks/${task.id}/follow-up`, "POST", {})).status).toBe(400)
    expect((await request("/api/runtime/disconnect", "POST")).status).toBe(200)
    expect(runtime.disconnect).toHaveBeenCalledTimes(1)
  })

  it("requires explicit user confirmation before clearing an uncertain start claim", async () => {
    const { request, tasks } = await workspace()
    const created = await request("/api/tasks", "POST", { title: "Recover start", projectDirectory: "/work/recover" })
    const { task } = await created.json() as { task: { id: string } }
    await request(`/api/tasks/${task.id}`, "PATCH", { column: "ready" })
    expect(tasks.claimStart(task.id, "claim-uncertain", Date.now())).toBe(true)
    expect((await request(`/api/tasks/${task.id}/recover-start`, "POST", {})).status).toBe(400)
    const recovered = await request(`/api/tasks/${task.id}/recover-start`, "POST", { confirmedNoSession: true })
    expect(recovered.status).toBe(200)
    const recoveredPayload = await recovered.json() as { task: Record<string, unknown> }
    expect(recoveredPayload.task.id).toBe(task.id)
    expect(recoveredPayload.task).not.toHaveProperty("startPending")
    const activityPayload = await (await request("/api/activity")).json() as { activities: Array<{ type: string }> }
    expect(activityPayload.activities[0]?.type).toBe("task.execution.start-claim-cleared")
  })

  it("refuses to delete a task after an OpenCode session has been linked", async () => {
    const { request, tasks } = await workspace()
    const created = await request("/api/tasks", "POST", { title: "Linked task", projectDirectory: "/work/linked" })
    const { task } = await created.json() as { task: { id: string } }
    await request(`/api/tasks/${task.id}`, "PATCH", { column: "ready" })
    expect(tasks.claimStart(task.id, "claim-linked", Date.now())).toBe(true)
    expect(tasks.claimSession(task.id, "ses-linked", Date.now() + 1, "claim-linked")).toBe(true)
    expect((await request(`/api/tasks/${task.id}`, "DELETE")).status).toBe(409)
    expect(tasks.getById(task.id)?.sessionID).toBe("ses-linked")
  })
})
