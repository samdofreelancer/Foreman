import type { OpenCodeGateway, RuntimeEvent, RuntimeSession } from "../../application/ports/opencode-gateway"

export type ConnectionState =
  | { status: "disconnected"; reason?: string }
  | { status: "connecting" }
  | { status: "connected"; version: string; connectedAt: number }
  | { status: "stale"; version?: string; reason: string }

export type ConnectionSupervisorOptions = {
  gateway: OpenCodeGateway
  linkedSessionIds: () => string[]
  reconcile: (sessionId: string, session: RuntimeSession | undefined) => Promise<void>
  onEvent?: (event: RuntimeEvent) => Promise<void> | void
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
  pollIntervalMs?: number
  startupTimeoutMs?: number
}

export class ConnectionSupervisor {
  state: ConnectionState = { status: "disconnected" }
  private stopped = true
  private worker?: Promise<void>
  private iterator?: AsyncIterator<RuntimeEvent>
  private streamAbort?: AbortController
  private poller?: ReturnType<typeof setInterval>

  constructor(private readonly options: ConnectionSupervisorOptions) {}

  async connect(): Promise<ConnectionState> {
    if (!this.stopped) return this.state
    this.stopped = false
    this.state = { status: "connecting" }
    try {
      const health = await withTimeout(this.options.gateway.health(), this.options.startupTimeoutMs ?? 10_000, "OpenCode startup timed out")
      if (!health.connected || !health.version) {
        this.state = { status: "disconnected", reason: health.reason ?? "OpenCode is unavailable" }
        this.stopped = true
        return this.state
      }
      await withTimeout(this.reconcileAll(), this.options.startupTimeoutMs ?? 10_000, "OpenCode session reconciliation timed out")
      this.state = { status: "connected", version: health.version, connectedAt: Date.now() }
      this.worker = this.consumeAndReconnect()
      const pollMs = this.options.pollIntervalMs ?? 15_000
      this.poller = setInterval(() => { void this.pollHealth() }, pollMs)
      return this.state
    } catch (error) {
      this.stopped = true
      this.state = { status: "disconnected", reason: safeMessage(error) }
      return this.state
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    if (this.poller) clearInterval(this.poller)
    this.poller = undefined
    this.streamAbort?.abort()
    this.streamAbort = undefined
    await this.iterator?.return?.()
    this.iterator = undefined
    await this.worker
    this.worker = undefined
    this.state = { status: "disconnected" }
  }

  private async pollHealth() {
    if (this.stopped) return
    let health: Awaited<ReturnType<OpenCodeGateway["health"]>>
    try { health = await this.options.gateway.health() }
    catch (error) { this.state = { status: "stale", reason: safeMessage(error) }; return }
    if (this.stopped) return
    if (!health.connected) {
      this.state = { status: "stale", reason: health.reason ?? "OpenCode health check failed" }
    } else if (this.state.status === "stale") {
      try {
        await this.reconcileAll()
        if (this.stopped) return
        this.state = { status: "connected", version: health.version ?? "unknown", connectedAt: Date.now() }
      } catch (error) {
        if (this.stopped) return
        this.state = { status: "stale", version: health.version, reason: safeMessage(error) }
      }
    }
  }

  private async consumeAndReconnect() {
    let attempt = 0
    while (!this.stopped) {
      try {
        const health = await this.options.gateway.health()
        if (!health.connected || !health.version) throw new Error(health.reason ?? "OpenCode disconnected")
        const controller = new AbortController()
        this.streamAbort = controller
        const iterator = this.options.gateway.subscribeEvents(controller.signal)[Symbol.asyncIterator]()
        this.iterator = iterator
        while (!this.stopped) {
          const next = await iterator.next()
          if (next.done) break
          await this.options.onEvent?.(next.value)
        }
        if (this.stopped) break
        this.state = { status: "stale", version: health.version, reason: "OpenCode event stream ended; reconciling" }
        await this.reconcileAll()
        this.state = { status: "connected", version: health.version, connectedAt: Date.now() }
        attempt = 0
      } catch (error) {
        if (this.stopped) break
        this.state = { status: "stale", reason: safeMessage(error) }
        try {
          const health = await this.options.gateway.health()
          if (health.connected && health.version) {
            await this.reconcileAll()
            this.state = { status: "connected", version: health.version, connectedAt: Date.now() }
          }
        } catch (reconcileError) {
          this.state = { status: "stale", reason: safeMessage(reconcileError) }
        }
      }
      if (this.stopped) break
      const base = this.options.reconnectDelayMs ?? 500
      const cap = this.options.maxReconnectDelayMs ?? 15_000
      await delay(Math.min(cap, base * 2 ** attempt++))
    }
  }

  private async reconcileAll() {
    for (const sessionId of this.options.linkedSessionIds()) {
      const session = await this.options.gateway.readSession(sessionId)
      await this.options.reconcile(sessionId, session)
    }
  }
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}
function safeMessage(error: unknown) { return error instanceof Error ? error.message.slice(0, 240) : "OpenCode connection failed" }
