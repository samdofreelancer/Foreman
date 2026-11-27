import { describe, expect, it, vi } from "vitest"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"
import { FallbackSecretStore, MemorySecretStore, WindowsCredentialStore } from "../src/adapters/opencode/secret-store"
import { RuntimeConnection, type ManagedProcessPort } from "../src/adapters/opencode/runtime-connection"

function fakeGateway(): OpenCodeGateway {
  return {
    health: vi.fn().mockResolvedValue({ connected: true, version: "2.4.2" }),
    listProjects: vi.fn(), createSession: vi.fn(), sendPrompt: vi.fn(), sendFollowUp: vi.fn(), interrupt: vi.fn(),
    readSession: vi.fn(), listPendingPermissions: vi.fn(), replyPermission: vi.fn(), listPendingQuestions: vi.fn(),
    replyQuestion: vi.fn(), subscribeEvents: vi.fn(),
  }
}

function fakeManaged(): ManagedProcessPort {
  return { start: vi.fn().mockResolvedValue("http://127.0.0.1:43199"), stop: vi.fn(), get url() { return "http://127.0.0.1:43199" } }
}

describe("RuntimeConnection ownership", () => {
  it("connects to an external server and never stops it on disconnect", async () => {
    const managed = fakeManaged()
    const gateway = fakeGateway()
    const connection = new RuntimeConnection(new MemorySecretStore(), { managed, createGateway: () => gateway })
    await connection.connectExternal({ mode: "external", endpoint: "http://localhost:4096" })
    expect(connection.connectionMode).toBe("external")
    expect(connection.endpoint).toBe("http://localhost:4096")
    await connection.disconnect()
    expect(managed.start).not.toHaveBeenCalled()
    expect(managed.stop).not.toHaveBeenCalled()
  })

  it("stops only its managed child when disconnecting managed mode", async () => {
    const managed = fakeManaged()
    const connection = new RuntimeConnection(new MemorySecretStore(), { managed, createGateway: () => fakeGateway() })
    await connection.connectManaged()
    expect(managed.start).toHaveBeenCalledOnce()
    await connection.disconnect()
    expect(managed.stop).toHaveBeenCalledOnce()
  })

  it("creates a private Basic Auth credential for each managed server and uses it for the SDK client", async () => {
    const managed = fakeManaged()
    const gateway = fakeGateway()
    const createGateway = vi.fn(() => gateway)
    const connection = new RuntimeConnection(new MemorySecretStore(), { managed, createGateway })
    await connection.connectManaged()

    const startedWith = vi.mocked(managed.start).mock.calls[0][0]
    expect(startedWith.username).toBe("opencode")
    expect(startedWith.password).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(createGateway).toHaveBeenCalledWith("http://127.0.0.1:43199", startedWith.password, startedWith.username)
    await connection.disconnect()
  })

  it("keeps external credentials in the process secret store, not endpoint URLs", async () => {
    const secrets = new MemorySecretStore()
    await secrets.set("remote-opencode", "secret-value")
    const createGateway = vi.fn(() => fakeGateway())
    const connection = new RuntimeConnection(secrets, { managed: fakeManaged(), createGateway })
    await connection.connectExternal({ mode: "external", endpoint: "https://opencode.example.test", secretKey: "remote-opencode" })
    expect(createGateway).toHaveBeenCalledWith("https://opencode.example.test", "secret-value", undefined)
    expect(connection.endpoint).not.toContain("secret-value")
  })

  it("rejects a missing configured secret instead of reporting a false healthy connection", async () => {
    const connection = new RuntimeConnection(new MemorySecretStore(), { managed: fakeManaged(), createGateway: () => fakeGateway() })
    await expect(connection.connectExternal({ mode: "external", endpoint: "http://localhost:4096", secretKey: "missing" })).rejects.toThrow("credential is not available")
  })

  it("requires an explicit disconnect before switching runtime ownership modes", async () => {
    const managed = fakeManaged()
    const connection = new RuntimeConnection(new MemorySecretStore(), { managed, createGateway: () => fakeGateway() })
    await connection.connectExternal({ mode: "external", endpoint: "http://localhost:4096" })
    await expect(connection.connectManaged()).rejects.toThrow("Disconnect the current external")
    await connection.disconnect()
    expect(managed.stop).not.toHaveBeenCalled()
  })
})

describe("WindowsCredentialStore", () => {
  it("uses the Credential Manager command contract for get, set and delete", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce("secret-base64")
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce("OK")
    const store = new WindowsCredentialStore(run)
    expect(await store.get("remote-opencode")).toBe(Buffer.from("secret-base64", "base64").toString("utf8"))
    await store.set("remote-opencode", "sensitive-value")
    await store.delete("remote-opencode")
    expect(JSON.parse(run.mock.calls[0][0])).toEqual({ op: "get", target: "Foreman:remote-opencode" })
    expect(JSON.parse(run.mock.calls[1][0])).toMatchObject({ op: "set", target: "Foreman:remote-opencode", value: "sensitive-value" })
    expect(JSON.parse(run.mock.calls[2][0])).toEqual({ op: "delete", target: "Foreman:remote-opencode" })
  })

  it("rejects oversized Windows secrets before invoking the vault", async () => {
    const run = vi.fn()
    const store = new WindowsCredentialStore(run)
    await expect(store.set("large", "x".repeat(1_281))).rejects.toThrow("exceeds 2560 bytes")
    expect(run).not.toHaveBeenCalled()
  })

  it("falls back to process-only memory when the OS vault is unavailable", async () => {
    const primary = { get: vi.fn().mockRejectedValue(new Error("vault unavailable")), set: vi.fn().mockRejectedValue(new Error("vault unavailable")), delete: vi.fn().mockRejectedValue(new Error("vault unavailable")) }
    const store = new FallbackSecretStore(primary, new MemorySecretStore())
    await store.set("api", "secret")
    expect(store.storageMode).toBe("process-memory")
    expect(await store.get("api")).toBe("secret")
    await expect(store.delete("api")).rejects.toThrow("persistent deletion could not be verified")
    expect(await store.get("api")).toBeUndefined()
  })

  if (process.platform === "win32") {
    it("can query Windows Credential Manager without creating or changing a credential", async () => {
      const store = new WindowsCredentialStore()
      await expect(store.get("phase3-read-only-probe-never-written")).resolves.toBeUndefined()
    })
  }
})
