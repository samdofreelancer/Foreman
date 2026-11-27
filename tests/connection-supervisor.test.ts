import { describe, expect, it, vi } from "vitest"
import { ConnectionSupervisor } from "../src/adapters/opencode/connection-supervisor"
import type { OpenCodeGateway } from "../src/application/ports/opencode-gateway"

function gateway(overrides: Partial<OpenCodeGateway> = {}) {
  return {
    health: vi.fn().mockResolvedValue({ connected: true, version: "2.4.2" }),
    readSession: vi.fn().mockResolvedValue({ id: "ses-1", status: "idle" }),
    subscribeEvents: vi.fn(() => (async function* () { yield { type: "session.idle", properties: { sessionID: "ses-1" } } })()),
    ...overrides,
  } as unknown as OpenCodeGateway
}

describe("ConnectionSupervisor", () => {
  it("reconciles linked sessions before publishing connected after a reconnect", async () => {
    const runtime = gateway()
    const reconcile = vi.fn().mockResolvedValue(undefined)
    const supervisor = new ConnectionSupervisor({ gateway: runtime, linkedSessionIds: () => ["ses-1"], reconcile, pollIntervalMs: 5, reconnectDelayMs: 5 })
    await supervisor.connect()
    expect(reconcile).toHaveBeenCalledWith("ses-1", { id: "ses-1", status: "idle" })
    expect(supervisor.state.status).toBe("connected")
    await supervisor.disconnect()
    expect(supervisor.state.status).toBe("disconnected")
  })

  it("reports disconnected when health fails and does not expose stale runtime as live", async () => {
    const supervisor = new ConnectionSupervisor({ gateway: gateway({ health: vi.fn().mockResolvedValue({ connected: false, reason: "offline" }) }), linkedSessionIds: () => [], reconcile: vi.fn() })
    await supervisor.connect()
    expect(supervisor.state).toMatchObject({ status: "disconnected", reason: "offline" })
  })

  it("resubscribes and reconciles after an event stream ends", async () => {
    let subscriptions = 0
    const runtime = gateway({ subscribeEvents: vi.fn(() => {
      subscriptions += 1
      return (async function* () {})()
    }) })
    const reconcile = vi.fn().mockResolvedValue(undefined)
    const supervisor = new ConnectionSupervisor({ gateway: runtime, linkedSessionIds: () => ["ses-1"], reconcile, reconnectDelayMs: 1, pollIntervalMs: 5 })
    await supervisor.connect()
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(subscriptions).toBeGreaterThan(1)
    expect(reconcile.mock.calls.length).toBeGreaterThan(1)
    await supervisor.disconnect()
  })

  it("aborts the active event stream on disconnect", async () => {
    let observedSignal: AbortSignal | undefined
    const runtime = gateway({ subscribeEvents: vi.fn((signal?: AbortSignal) => {
      observedSignal = signal
      return (async function* () {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
      })()
    }) })
    const supervisor = new ConnectionSupervisor({ gateway: runtime, linkedSessionIds: () => [], reconcile: vi.fn(), pollIntervalMs: 60_000 })
    await supervisor.connect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await supervisor.disconnect()
    expect(observedSignal?.aborted).toBe(true)
  })

  it("marks the runtime stale on health loss and reconciles before returning to connected", async () => {
    let checks = 0
    const runtime = gateway({ health: vi.fn().mockImplementation(async () => {
      checks += 1
      return checks === 1 ? { connected: true, version: "2.4.2" } : checks === 2
        ? { connected: false, reason: "connection reset" }
        : { connected: true, version: "2.4.2" }
    }) })
    const reconcile = vi.fn().mockResolvedValue(undefined)
    const supervisor = new ConnectionSupervisor({ gateway: runtime, linkedSessionIds: () => ["ses-1"], reconcile, pollIntervalMs: 5, reconnectDelayMs: 2 })
    await supervisor.connect()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(supervisor.state.status).toBe("connected")
    expect(reconcile.mock.calls.length).toBeGreaterThan(1)
    await supervisor.disconnect()
  })

  it("fails closed when the initial health check exceeds the startup timeout", async () => {
    const runtime = gateway({ health: vi.fn(() => new Promise<{ connected: boolean; version?: string; reason?: string }>(() => undefined)) })
    const supervisor = new ConnectionSupervisor({ gateway: runtime, linkedSessionIds: () => [], reconcile: vi.fn(), startupTimeoutMs: 5 })
    await expect(supervisor.connect()).resolves.toMatchObject({ status: "disconnected", reason: "OpenCode startup timed out" })
  })
})
