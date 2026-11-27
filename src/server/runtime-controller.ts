import type { TaskRepository } from "../application/ports/repositories"
import type { TaskExecutionService } from "../application/task-execution"
import type { OpenCodeGateway } from "../application/ports/opencode-gateway"
import { ConnectionSupervisor, type ConnectionState } from "../adapters/opencode/connection-supervisor"
import { MemorySecretStore } from "../adapters/opencode/secret-store"
import { RuntimeConnection } from "../adapters/opencode/runtime-connection"

export type RuntimeConnectInput =
  | { mode: "managed"; executable?: string }
  | { mode: "external"; endpoint: string; username?: string; password?: string }

export type RuntimeStatus = ConnectionState & { mode?: "managed" | "external"; sessionBaseUrl?: string }

/** Owns the active runtime connection and its event/reconciliation supervisor. */
export class ForemanRuntimeController {
  private readonly secrets: MemorySecretStore
  private readonly connection: RuntimeConnection
  private gateway?: OpenCodeGateway
  private supervisor?: ConnectionSupervisor

  constructor(private readonly tasks: TaskRepository, private readonly execution: TaskExecutionService, options: { connection?: RuntimeConnection; secrets?: MemorySecretStore } = {}) {
    this.secrets = options.secrets ?? new MemorySecretStore()
    this.connection = options.connection ?? new RuntimeConnection(this.secrets)
  }

  get activeGateway(): OpenCodeGateway | undefined {
    return this.supervisor?.state.status === "connected" ? this.gateway : undefined
  }

  get status(): RuntimeStatus {
    const state = this.supervisor?.state ?? { status: "disconnected" as const }
    const endpoint = this.connection.endpoint?.replace(/\/+$/, "")
    const serverKey = endpoint ? Buffer.from(endpoint, "utf8").toString("base64url") : undefined
    return { ...state, mode: this.connection.connectionMode, ...(endpoint && serverKey ? { sessionBaseUrl: `${endpoint}/server/${serverKey}/session` } : {}) }
  }

  async connect(input: RuntimeConnectInput): Promise<RuntimeStatus> {
    if (this.connection.connectionMode) throw new Error("Disconnect the current OpenCode runtime before connecting another")
    if (input.mode === "managed") {
      this.gateway = await this.connection.connectManaged({ mode: "managed", executable: input.executable?.trim() || undefined })
    } else {
      const secretKey = input.password ? `runtime-${crypto.randomUUID()}` : undefined
      if (secretKey) await this.secrets.set(secretKey, input.password!)
      try {
        this.gateway = await this.connection.connectExternal({
          mode: "external", endpoint: input.endpoint, username: input.username?.trim() || undefined, secretKey,
        })
      } catch (error) {
        if (secretKey) await this.secrets.delete(secretKey)
        throw error
      }
    }
    this.supervisor = new ConnectionSupervisor({
      gateway: this.gateway,
      linkedSessionIds: () => this.tasks.list().flatMap((task) => task.sessionID ? [task.sessionID] : []),
      reconcile: (sessionId, session) => this.execution.reconcileSession(sessionId, session),
      onEvent: (event) => this.execution.handleRuntimeEvent(event),
    })
    const state = await this.supervisor.connect()
    if (state.status !== "connected") {
      await this.disconnect()
      throw new Error("reason" in state ? state.reason : "OpenCode could not be connected")
    }
    return this.status
  }

  async disconnect(): Promise<void> {
    await this.supervisor?.disconnect()
    this.supervisor = undefined
    this.gateway = undefined
    await this.connection.disconnect()
    this.secrets.clear()
  }

  async close(): Promise<void> { await this.disconnect() }
}
