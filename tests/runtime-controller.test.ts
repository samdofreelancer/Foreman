import { describe, expect, it, vi } from "vitest"
import type { TaskRepository, ActivityRepository } from "../src/application/ports/repositories"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"
import { TaskExecutionService } from "../src/application/task-execution"
import { RuntimeConnection } from "../src/adapters/opencode/runtime-connection"
import { MemorySecretStore } from "../src/adapters/opencode/secret-store"
import { ForemanRuntimeController } from "../src/server/runtime-controller"

function fixture() {
  const tasks = { list: () => [], getById: () => undefined } as unknown as TaskRepository
  const activities = { append: vi.fn() } as unknown as ActivityRepository
  const execution = new TaskExecutionService({ tasks, activities, transaction: (operation) => operation(), gateway: () => undefined })
  const gateway: OpenCodeGateway = {
    health: vi.fn(async () => ({ connected: true, version: "2.4.2" })),
    listProjects: vi.fn(async () => []),
    createSession: vi.fn(async () => ({ id: "ses-1" })),
    sendPrompt: vi.fn(async () => undefined), sendFollowUp: vi.fn(async () => undefined), interrupt: vi.fn(async () => undefined),
    readSession: vi.fn(async () => undefined), listPendingPermissions: vi.fn(async () => []), replyPermission: vi.fn(async () => undefined),
    listPendingQuestions: vi.fn(async () => []), replyQuestion: vi.fn(async () => undefined),
    subscribeEvents: (signal) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
      },
    }),
  }
  const managed = { start: vi.fn(async () => "http://127.0.0.1:4096"), stop: vi.fn(async () => undefined), url: "http://127.0.0.1:4096" }
  const secrets = new MemorySecretStore()
  const connection = new RuntimeConnection(secrets, { managed, createGateway: () => gateway })
  const controller = new ForemanRuntimeController(tasks, execution, { connection, secrets })
  return { controller, gateway, managed }
}

describe("ForemanRuntimeController", () => {
  it("connects a managed OpenCode 2.4.x runtime, supervises it, and stops only its owned process", async () => {
    const f = fixture()
    await expect(f.controller.connect({ mode: "managed" })).resolves.toMatchObject({ status: "connected", version: "2.4.2", mode: "managed", sessionBaseUrl: "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session" })
    expect(f.controller.activeGateway).toBe(f.gateway)
    await f.controller.disconnect()
    expect(f.managed.stop).toHaveBeenCalledTimes(1)
    expect(f.controller.status).toMatchObject({ status: "disconnected" })
  })

  it("connects external mode without taking ownership or stopping the external server", async () => {
    const f = fixture()
    await expect(f.controller.connect({ mode: "external", endpoint: "http://127.0.0.1:4096", password: "temporary" }))
      .resolves.toMatchObject({ status: "connected", mode: "external" })
    await f.controller.disconnect()
    expect(f.managed.stop).not.toHaveBeenCalled()
    expect(f.controller.activeGateway).toBeUndefined()
  })
})
