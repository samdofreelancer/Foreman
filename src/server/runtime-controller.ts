import type { RuntimeConnectionSettings, RuntimeSettingsRepository, TaskRepository } from "../application/ports/repositories"
import type { TaskExecutionService } from "../application/task-execution"
import type { OpenCodeGateway, RuntimeEvent } from "../application/ports/opencode-gateway"
import { ConnectionSupervisor, type ConnectionState } from "../adapters/opencode/connection-supervisor"
import { createDefaultSecretStore } from "../adapters/opencode/secret-store"
import { RuntimeConnection } from "../adapters/opencode/runtime-connection"
import type { SecretStore } from "../application/ports/secret-store"

export type RuntimeConnectInput =
  | { mode: "managed"; executable?: string }
  | { mode: "external"; endpoint: string; username?: string; password?: string; secretRef?: string }

export type RuntimeStatus = ConnectionState & { mode?: "managed" | "external"; sessionBaseUrl?: string }

/** Owns the active runtime connection and its event/reconciliation supervisor. */
export class ForemanRuntimeController {
  private readonly secrets: SecretStore & { readonly storageMode?: string }
  private readonly connection: RuntimeConnection
  private gateway?: OpenCodeGateway
  private supervisor?: ConnectionSupervisor
  private readonly eventListeners = new Set<(event: RuntimeEvent) => void>()

  constructor(private readonly tasks: TaskRepository, private readonly execution: TaskExecutionService, options: {
    connection?: RuntimeConnection
    secrets?: SecretStore & { readonly storageMode?: string }
    settings?: RuntimeSettingsRepository
  } = {}) {
    this.secrets = options.secrets ?? createDefaultSecretStore()
    this.settingsRepository = options.settings
    this.connection = options.connection ?? new RuntimeConnection(this.secrets)
  }
  private readonly settingsRepository?: RuntimeSettingsRepository

  get activeGateway(): OpenCodeGateway | undefined {
    return this.supervisor?.state.status === "connected" ? this.gateway : undefined
  }

  subscribeEvents(listener: (event: RuntimeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  get status(): RuntimeStatus {
    const state = this.supervisor?.state ?? { status: "disconnected" as const }
    const endpoint = this.connection.endpoint?.replace(/\/+$/, "")
    const serverKey = endpoint ? Buffer.from(endpoint, "utf8").toString("base64url") : undefined
    return { ...state, ...(state.status === "disconnected" && this.lastRestoreError ? { reason: this.lastRestoreError } : {}), mode: this.connection.connectionMode, ...(endpoint && serverKey ? { sessionBaseUrl: `${endpoint}/server/${serverKey}/session` } : {}) }
  }

  get settings() {
    const settings = this.settingsRepository?.get()
    if (!settings) return undefined
    const { secretRef: _secretRef, ...safe } = settings
    return safe
  }

  async connect(input: RuntimeConnectInput): Promise<RuntimeStatus> {
    if (this.connection.connectionMode) throw new Error("Disconnect the current OpenCode runtime before connecting another")
    let activeSecretRef: string | undefined
    if (input.mode === "managed") {
      this.gateway = await this.connection.connectManaged({ mode: "managed", executable: input.executable?.trim() || undefined })
    } else {
      const previous = this.settingsRepository?.get()
      const sameSavedExternal = previous?.mode === "external" && previous.endpoint === input.endpoint && previous.username === input.username
      activeSecretRef = input.password ? input.secretRef ?? `runtime-${crypto.randomUUID()}` : input.secretRef ?? (sameSavedExternal ? previous.secretRef : undefined)
      if (activeSecretRef && input.password) await this.secrets.set(activeSecretRef, input.password)
      try {
        this.gateway = await this.connection.connectExternal({
          mode: "external", endpoint: input.endpoint, username: input.username?.trim() || undefined, secretKey: activeSecretRef,
        })
      } catch (error) {
        if (activeSecretRef && input.password) await this.secrets.delete(activeSecretRef).catch(() => undefined)
        throw error
      }
    }
    this.supervisor = new ConnectionSupervisor({
      gateway: this.gateway,
      linkedSessionIds: () => this.tasks.list().flatMap((task) => task.sessionID ? [task.sessionID] : []),
      reconcile: (sessionId, session) => this.execution.reconcileSession(sessionId, session),
      onEvent: async (event) => {
        for (const listener of this.eventListeners) listener(event)
        await this.execution.handleRuntimeEvent(event)
      },
    })
    const state = await this.supervisor.connect()
    if (state.status !== "connected") {
      await this.dropConnection()
      throw new Error("reason" in state ? state.reason : "OpenCode could not be connected")
    }
    const secretRef = input.mode === "external" && this.secrets.storageMode === "os-vault" ? activeSecretRef : undefined
    this.settingsRepository?.save({
      mode: input.mode,
      ...(input.mode === "managed" && input.executable?.trim() ? { executable: input.executable.trim() } : {}),
      ...(input.mode === "external" ? { endpoint: input.endpoint, ...(input.username?.trim() ? { username: input.username.trim() } : {}) } : {}),
      ...(secretRef ? { secretRef } : {}),
      credentialRequired: input.mode === "external" && (!!input.password && this.secrets.storageMode !== "os-vault"),
      autoConnect: !(input.mode === "external" && !!input.password && this.secrets.storageMode !== "os-vault"),
      updatedAt: Date.now(),
    })
    this.lastRestoreError = undefined
    return this.status
  }

  async disconnect(): Promise<void> {
    await this.dropConnection()
    const settings = this.settingsRepository?.get()
    if (settings) this.settingsRepository?.save({ ...settings, autoConnect: false, updatedAt: Date.now() })
  }

  async restore(): Promise<void> {
    const settings = this.settingsRepository?.get()
    if (!settings?.autoConnect) return
    if (settings.credentialRequired) return
    try {
      await this.connect(settings.mode === "managed"
        ? { mode: "managed", executable: settings.executable }
        : { mode: "external", endpoint: settings.endpoint!, username: settings.username, secretRef: settings.secretRef })
    } catch (error) {
      this.lastRestoreError = error instanceof Error ? error.message.slice(0, 240) : "Saved OpenCode connection could not be restored"
    }
  }

  async reconnect(): Promise<RuntimeStatus> {
    const settings = this.settingsRepository?.get()
    if (!settings) throw new Error("No saved OpenCode connection is available")
    if (settings.credentialRequired) throw new Error("Re-enter the OpenCode password before reconnecting")
    await this.dropConnection()
    return this.connect(settings.mode === "managed"
      ? { mode: "managed", executable: settings.executable }
      : { mode: "external", endpoint: settings.endpoint!, username: settings.username, secretRef: settings.secretRef })
  }

  private lastRestoreError?: string

  private async dropConnection(): Promise<void> {
    await this.supervisor?.disconnect()
    this.supervisor = undefined
    this.gateway = undefined
    await this.connection.disconnect()
    if (this.secrets.storageMode === "process-memory" && "clear" in this.secrets && typeof this.secrets.clear === "function") this.secrets.clear()
  }

  /** Stop active resources during app shutdown without changing the user's auto-connect preference. */
  async close(): Promise<void> { await this.dropConnection() }
}
