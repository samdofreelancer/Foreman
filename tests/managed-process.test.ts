import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { ManagedOpenCodeProcess, resolveOpenCodeExecutable } from "../src/adapters/opencode/managed-process"
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

const identity = async (name: string) => name
const supportedVersion = async () => "2.4.2"
const credentials = { username: "opencode", password: "a-random-local-password" }

describe("resolveOpenCodeExecutable", () => {
  it("keeps the bare command name on non-Windows platforms", async () => {
    const run = vi.fn()
    await expect(resolveOpenCodeExecutable("opencode", "linux", run, vi.fn(), vi.fn())).resolves.toBe("opencode")
    expect(run).not.toHaveBeenCalled()
  })

  it("prefers a real .exe found on PATH", async () => {
    const run = vi.fn(async () => ({ stdout: "C:\\tools\\opencode.exe\r\nC:\\tools\\opencode.cmd\r\n" }))
    const readFile = vi.fn()
    await expect(resolveOpenCodeExecutable("opencode", "win32", run, readFile, () => true)).resolves.toBe("C:\\tools\\opencode.exe")
    expect(readFile).not.toHaveBeenCalled()
  })

  it("resolves the real executable behind an npm .cmd shim", async () => {
    const shim = "C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.cmd"
    const target = "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe"
    const run = vi.fn(async () => ({ stdout: "C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode\r\nC:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.cmd\r\n" }))
    const readFile = vi.fn(() => '@ECHO off\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n')
    const exists = vi.fn((path: string) => path === target)

    await expect(resolveOpenCodeExecutable("opencode", "win32", run, readFile, exists)).resolves.toBe(target)
    expect(readFile).toHaveBeenCalledWith(shim)
  })

  it("falls back to the bare name when the shim has no resolvable target", async () => {
    const run = vi.fn(async () => ({ stdout: "C:\\tools\\opencode.cmd\r\n" }))
    const readFile = vi.fn(() => "@ECHO off\r\nnode \"%~dp0\\cli.js\" %*\r\n")
    await expect(resolveOpenCodeExecutable("opencode", "win32", run, readFile, () => false)).resolves.toBe("opencode")
  })

  it("falls back to the bare name when the command is not on PATH", async () => {
    const run = vi.fn(async () => { throw new Error("INFO: Could not find files") })
    await expect(resolveOpenCodeExecutable("opencode", "win32", run, vi.fn(), vi.fn())).resolves.toBe("opencode")
  })
})

describe("ManagedOpenCodeProcess", () => {
  it("starts a loopback-only child and terminates only the exact child it spawned", async () => {
    const child = new FakeChild()
    const spawnChild = vi.fn(() => child as unknown as ChildProcess)
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43199, identity, supportedVersion)
    const endpoint = await managed.start({ ...credentials, healthCheck: async (url) => url === "http://127.0.0.1:43199" })
    expect(endpoint).toBe("http://127.0.0.1:43199")
    expect(spawnChild).toHaveBeenCalledWith("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "43199"], expect.objectContaining({ shell: false, windowsHide: true, env: expect.objectContaining({ OPENCODE_SERVER_USERNAME: credentials.username, OPENCODE_SERVER_PASSWORD: credentials.password }) }))
    await managed.stop()
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
    expect(managed.pid).toBeUndefined()
  })

  it("does not attempt to terminate a process that has already exited", async () => {
    const child = new FakeChild()
    child.exitCode = 2
    const managed = new ManagedOpenCodeProcess(vi.fn(() => child as unknown as ChildProcess) as never, async () => 43200, identity, supportedVersion)
    await expect(managed.start({ ...credentials, healthCheck: async () => false, startupTimeoutMs: 5 })).rejects.toThrow("exited during startup")
    expect(child.kill).not.toHaveBeenCalled()
  })

  it("spawns the resolved executable instead of the bare command name", async () => {
    const child = new FakeChild()
    const spawnChild = vi.fn(() => child as unknown as ChildProcess)
    const resolved = "C:\\tools\\opencode-ai\\bin\\opencode.exe"
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43201, async () => resolved, supportedVersion)
    await managed.start({ ...credentials, healthCheck: async () => true })
    expect(spawnChild).toHaveBeenCalledWith(resolved, expect.any(Array), expect.objectContaining({ shell: false }))
  })

  it("reports a missing executable clearly instead of a raw Windows exit code", async () => {
    const child = new FakeChild()
    const spawnChild = vi.fn(() => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" })))
      return child as unknown as ChildProcess
    })
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43202, async () => "opencode", supportedVersion)
    await expect(managed.start({ ...credentials, healthCheck: async () => false, startupTimeoutMs: 2000 }))
      .rejects.toThrow(/OpenCode executable "opencode" was not found/)
  })

  it("falls back from an incompatible PATH CLI to the bundled OpenCode Desktop 2.4.x CLI", async () => {
    const child = new FakeChild()
    const desktop = "C:\\Users\\dev\\AppData\\Roaming\\ai.opencode.desktop\\cli\\2.4.2-x64\\opencode-cli.exe"
    const readVersion = vi.fn(async (file: string) => file === "opencode" ? "1.19.6" : "2.4.2")
    const managed = new ManagedOpenCodeProcess(vi.fn(() => child as unknown as ChildProcess) as never, async () => 43203, identity, readVersion, () => desktop)
    await managed.start({ ...credentials, healthCheck: async () => true })
    expect(readVersion).toHaveBeenNthCalledWith(1, "opencode")
    expect(readVersion).toHaveBeenNthCalledWith(2, desktop)
    expect(managed.pid).toBe(9876)
    await managed.stop()
  })

  it("fails before spawning when an explicitly selected CLI is not OpenCode 2.4.x", async () => {
    const spawnChild = vi.fn()
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43204, identity, async () => "1.19.6", () => "desktop-2.4.2.exe")
    await expect(managed.start({ ...credentials, executable: "opencode", healthCheck: async () => true }))
      .rejects.toThrow("OpenCode 1.19.6 is not supported; Foreman requires 2.4.x")
    expect(spawnChild).not.toHaveBeenCalled()
  })

  it("reports a missing executable as an installation/path error", async () => {
    const spawnChild = vi.fn()
    const missing = Object.assign(new Error("spawn missing ENOENT"), { code: "ENOENT" })
    const managed = new ManagedOpenCodeProcess(spawnChild as never, async () => 43205, identity, async () => { throw missing })
    await expect(managed.start({ ...credentials, executable: "C:\\missing\\opencode.exe", healthCheck: async () => true }))
      .rejects.toThrow(/OpenCode executable .* was not found/)
    expect(spawnChild).not.toHaveBeenCalled()
  })
})
