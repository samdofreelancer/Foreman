import type { OpenCodeGateway } from "../../application/ports/opencode-gateway"
import type { SecretStore } from "../../application/ports/secret-store"
import { randomBytes } from "node:crypto"
import { createOpenCodeClient, OpenCodeGatewayAdapter, validateOpenCodeEndpoint } from "./gateway"
import { ManagedOpenCodeProcess } from "./managed-process"
import { RemoteManagedOpenCodeProcess } from "./remote-managed-process"

export type ExternalConnection = { mode: "external"; endpoint: string; secretKey?: string; username?: string }
export type ManagedConnection = { mode: "managed"; executable?: string }
export interface ManagedProcessPort {
  start(options: { executable?: string; username: string; password: string; healthCheck: (endpoint: string) => Promise<boolean> }): Promise<string>
  stop(): Promise<void>
  readonly url?: string
  readonly authorizationHeader?: string
}
export type GatewayFactory = (endpoint: string, password?: string, username?: string) => OpenCodeGateway

/** Selects a runtime without ever adopting an unowned OpenCode service. */
export class RuntimeConnection {
  private readonly managed: ManagedProcessPort
  private activeMode?: "managed" | "external"
  private gateway?: OpenCodeGateway
  private activeEndpoint?: string

  constructor(private readonly secrets: SecretStore, options: { managed?: ManagedProcessPort; createGateway?: GatewayFactory } = {}) {
    this.managed = options.managed ?? (process.platform !== "win32" && process.env.FOREMAN_HOST_AGENT_TOKEN
      ? new RemoteManagedOpenCodeProcess()
      : new ManagedOpenCodeProcess())
    this.createGateway = options.createGateway ?? ((endpoint, password, username) => {
      // The Windows Host Agent authenticates its private capability URL and injects
      // OpenCode Basic Auth locally; never send the OpenCode password over HTTP/WSL.
      const credentials = this.managed instanceof RemoteManagedOpenCodeProcess ? undefined : password ? { password, username } : undefined
      return new OpenCodeGatewayAdapter(createOpenCodeClient(endpoint, credentials, this.managed.authorizationHeader))
    })
  }
  private readonly createGateway: GatewayFactory

  async connectExternal(config: ExternalConnection): Promise<OpenCodeGateway> {
    this.assertDisconnected()
    const endpoint = validateOpenCodeEndpoint(config.endpoint)
    const password = config.secretKey ? await this.secrets.get(config.secretKey) : undefined
    if (config.secretKey && !password) throw new Error("The configured OpenCode credential is not available in the secret store")
    const gateway = this.createGateway(endpoint, password, config.username)
    const health = await gateway.health()
    if (!health.connected) throw new Error(health.reason ?? "OpenCode server is unavailable or unsupported")
    await gateway.listProjects() // validates endpoint authentication and the required project API
    this.gateway = gateway
    this.activeMode = "external"
    this.activeEndpoint = endpoint
    return gateway
  }

  async connectManaged(config: ManagedConnection = { mode: "managed" }): Promise<OpenCodeGateway> {
    this.assertDisconnected()
    const username = process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode"
    const password = process.env.OPENCODE_SERVER_PASSWORD || randomBytes(32).toString("base64url")
    try {
      const endpoint = await this.managed.start({
        executable: config.executable,
        username,
        password,
        healthCheck: async (url) => {
          const candidate = this.createGateway(url, password, username)
          const health = await candidate.health()
          if (health.version && !/^2\.4\./.test(health.version)) {
            throw Object.assign(new Error(`OpenCode ${health.version} is not supported; Foreman requires 2.4.x`), { code: "UNSUPPORTED_RUNTIME_VERSION" })
          }
          if (!health.connected) return false
          await candidate.listProjects() // also verifies configured server authentication
          return true
        },
      })
      const gateway = this.createGateway(endpoint, password, username)
      this.gateway = gateway
      this.activeMode = "managed"
      this.activeEndpoint = endpoint
      return gateway
    } catch (error) {
      await this.managed.stop()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    const ownedMode = this.activeMode
    this.activeMode = undefined
    this.gateway = undefined
    this.activeEndpoint = undefined
    if (ownedMode === "managed") await this.managed.stop()
    // External servers are user-owned: disconnect only drops our client reference.
  }

  get connectionMode() { return this.activeMode }
  get endpoint() { return this.activeEndpoint }

  private assertDisconnected() {
    if (this.activeMode) throw new Error(`Disconnect the current ${this.activeMode} OpenCode runtime before switching modes`)
  }
}
