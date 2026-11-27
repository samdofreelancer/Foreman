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
  const settings = { value: undefined as import("../src/application/ports/repositories").RuntimeConnectionSettings | undefined,
    get() { return this.value }, save(value: import("../src/application/ports/repositories").RuntimeConnectionSettings) { this.value = value } }
  const connection = new RuntimeConnection(secrets, { managed, createGateway: () => gateway })
  const controller = new ForemanRuntimeController(tasks, execution, { connection, secrets, settings })
  return { controller, gateway, managed, settings, secrets }
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

  it("persists safe managed settings and can explicitly restart its owned child", async () => {
    const f = fixture()
    await f.controller.connect({ mode: "managed", executable: "C:/tools/opencode-2.4.2.exe" })
    expect(f.settings.get()).toMatchObject({ mode: "managed", executable: "C:/tools/opencode-2.4.2.exe", autoConnect: true, credentialRequired: false })
    await f.controller.reconnect()
    expect(f.managed.start).toHaveBeenCalledTimes(2)
    expect(f.managed.stop).toHaveBeenCalledTimes(1)
    await f.controller.disconnect()
    expect(f.settings.get()).toMatchObject({ autoConnect: false })
  })

  it("never persists an external password when only process-memory secret storage is available", async () => {
    const f = fixture()
    await f.controller.connect({ mode: "external", endpoint: "http://127.0.0.1:4096", username: "dev", password: "top-secret" })
    expect(f.settings.get()).toMatchObject({ mode: "external", endpoint: "http://127.0.0.1:4096", username: "dev", credentialRequired: true, autoConnect: false })
    expect(JSON.stringify(f.settings.get())).not.toContain("top-secret")
    await f.controller.disconnect()
    expect(f.secrets.storageMode).toBe("process-memory")
  })

  it("keeps OS-vault references out of the browser-facing settings view", async () => {
    const f = fixture()
    Object.defineProperty(f.secrets, "storageMode", { value: "os-vault" })
    await f.controller.connect({ mode: "external", endpoint: "https://opencode.example.test", username: "dev", password: "vault-secret" })
    expect(f.settings.get()).toMatchObject({ secretRef: expect.any(String), credentialRequired: false, autoConnect: true })
    expect(f.controller.settings).not.toHaveProperty("secretRef")
    expect(JSON.stringify(f.controller.settings)).not.toContain("vault-secret")
  })

  it("restores saved managed connections on startup but leaves password-protected memory-only connections for re-entry", async () => {
    const managed = fixture()
    managed.settings.save({ mode: "managed", executable: "opencode-2.4.2", credentialRequired: false, autoConnect: true, updatedAt: 1 })
    await managed.controller.restore()
    expect(managed.controller.status.status).toBe("connected")
    expect(managed.managed.start).toHaveBeenCalledTimes(1)

    const external = fixture()
    external.settings.save({ mode: "external", endpoint: "http://127.0.0.1:4096", credentialRequired: true, autoConnect: false, updatedAt: 1 })
    await external.controller.restore()
    expect(external.controller.status.status).toBe("disconnected")
    expect("reason" in external.controller.status ? external.controller.status.reason : undefined).toBeUndefined()
    expect(external.managed.start).not.toHaveBeenCalled()
  })

  it("preserves auto-connect settings on application shutdown while explicit disconnect disables them", async () => {
    const f = fixture()
    await f.controller.connect({ mode: "managed", executable: "opencode-2.4.2" })
    await f.controller.close()
    expect(f.settings.get()).toMatchObject({ autoConnect: true })
    expect(f.managed.stop).toHaveBeenCalledTimes(1)

    await f.controller.restore()
    expect(f.controller.status.status).toBe("connected")
    await f.controller.disconnect()
    expect(f.settings.get()).toMatchObject({ autoConnect: false })
  })

  it("rejects an unsupported runtime version and releases only the managed child it started", async () => {
    const f = fixture()
    f.gateway.health = vi.fn(async () => ({ connected: false, version: "1.19.6", reason: "OpenCode 1.19.6 is not supported; Foreman requires 2.4.x" }))
    await expect(f.controller.connect({ mode: "managed" })).rejects.toThrow("requires 2.4.x")
    expect(f.managed.stop).toHaveBeenCalledTimes(1)
    expect(f.controller.status.status).toBe("disconnected")
    expect(f.settings.get()).toBeUndefined()
  })
})
