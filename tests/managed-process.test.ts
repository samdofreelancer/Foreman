import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { ManagedOpenCodeProcess } from "../src/adapters/opencode/managed-process"
import type { ChildProcess } from "node:child_process"

class FakeChild extends EventEmitter {
  pid = 9876
  exitCode: number | null = null
  killed = false
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.killed = true
    this.exitCode = signal === "SIGKILL" ? 137 : 0
    queueMicrotask(() => this.emit("exit", this.exitCode, signal ?? null))
    return true
  })
}

describe("ManagedOpenCodeProcess", () => {
  it("starts a loopback-only child and terminates only the exact child it spawned", async () => {
    const child = new FakeChild()
    const spawnChild = vi.fn(() => child as unknown as ChildProcess)
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43199)
    const endpoint = await managed.start({ healthCheck: async (url) => url === "http://127.0.0.1:43199" })
    expect(endpoint).toBe("http://127.0.0.1:43199")
    expect(spawnChild).toHaveBeenCalledWith("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "43199"], expect.objectContaining({ shell: false, windowsHide: true }))
    await managed.stop()
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
    expect(managed.pid).toBeUndefined()
  })

  it("does not attempt to terminate a process that has already exited", async () => {
    const child = new FakeChild()
    child.exitCode = 2
    const managed = new ManagedOpenCodeProcess(vi.fn(() => child as unknown as ChildProcess) as never, async () => 43200)
    await expect(managed.start({ healthCheck: async () => false, startupTimeoutMs: 5 })).rejects.toThrow("exited during startup")
    expect(child.kill).not.toHaveBeenCalled()
  })
})
