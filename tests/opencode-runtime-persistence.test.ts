import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"
import { SqliteDatabase } from "../src/adapters/persistence/sqlite/database"
import { SqliteTaskRepository } from "../src/adapters/persistence/sqlite/task-repository"
import { createTask } from "../src/domain/task"
import { ConnectionSupervisor } from "../src/adapters/opencode/connection-supervisor"

const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("OpenCode disconnect and Foreman-owned persistence", () => {
  it("keeps task records intact when the managed runtime exits unexpectedly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "foreman-runtime-loss-"))
    directories.push(directory)
    const database = new SqliteDatabase(join(directory, "foreman.sqlite"))
    databases.push(database)
    const tasks = new SqliteTaskRepository(database)
    const task = createTask({ title: "Persist through runtime exit", projectDirectory: directory, column: "ready" }, 10, "task-runtime-loss")
    tasks.create(task)

    let runtimeOnline = true
    const gateway: OpenCodeGateway = {
      health: vi.fn(async () => runtimeOnline ? { connected: true, version: "2.4.2" } : { connected: false, reason: "managed child exited" }),
      readSession: vi.fn().mockResolvedValue(undefined),
      subscribeEvents: vi.fn((signal?: AbortSignal) => (async function* () {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
      })()),
      listProjects: vi.fn(), createSession: vi.fn(), sendPrompt: vi.fn(), sendFollowUp: vi.fn(), interrupt: vi.fn(),
      listPendingPermissions: vi.fn(), replyPermission: vi.fn(), listPendingQuestions: vi.fn(), replyQuestion: vi.fn(),
    }
    const supervisor = new ConnectionSupervisor({ gateway, linkedSessionIds: () => [], reconcile: vi.fn(), pollIntervalMs: 5 })
    await supervisor.connect()
    runtimeOnline = false
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(supervisor.state).toMatchObject({ status: "stale", reason: "managed child exited" })
    expect(tasks.getById(task.id)).toEqual(task)
    await supervisor.disconnect()
  })
})
