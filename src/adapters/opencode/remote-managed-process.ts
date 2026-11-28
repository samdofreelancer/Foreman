import type { ManagedProcessPort } from "./runtime-connection"

type AgentResponse = { endpoint?: string; token?: string; error?: string }

/** Controls the Windows OpenCode host agent from a Linux Foreman container. */
export class RemoteManagedOpenCodeProcess implements ManagedProcessPort {
  private endpoint?: string
  private proxyToken?: string
  private readonly baseUrl: string
  private readonly token: string

  constructor(options: { baseUrl?: string; token?: string; request?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.FOREMAN_HOST_AGENT_URL ?? "http://host.docker.internal:4320").replace(/\/+$/, "")
    this.token = options.token ?? process.env.FOREMAN_HOST_AGENT_TOKEN ?? ""
    this.request = options.request ?? fetch
  }
  private readonly request: typeof fetch

  async start(options: { executable?: string; username: string; password: string; healthCheck: (endpoint: string) => Promise<boolean> }): Promise<string> {
    if (!this.token) throw new Error("FOREMAN_HOST_AGENT_TOKEN is not configured; restart Foreman using the Windows Docker startup task")
    const response = await this.request(`${this.baseUrl}/runtime/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      // OpenCode credentials are generated and retained by the Windows agent.
      // Never send them over the Docker↔Windows HTTP boundary.
      body: JSON.stringify({ executable: options.executable }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await readResponse(response)
    if (!response.ok || !body.endpoint || !body.token || !/^[a-f0-9]{64}$/.test(body.token)) throw new Error(body.error ?? `Windows OpenCode host agent returned an invalid runtime capability (HTTP ${response.status})`)
    this.endpoint = body.endpoint
    this.proxyToken = body.token
    try {
      if (!await options.healthCheck(body.endpoint)) throw new Error("Windows OpenCode server did not become healthy")
      return body.endpoint
    } catch (error) {
      await this.stop().catch(() => undefined)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.endpoint) return
    this.endpoint = undefined
    this.proxyToken = undefined
    const response = await this.request(`${this.baseUrl}/runtime/stop`, {
      method: "POST", headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Windows OpenCode host agent could not stop its managed process (HTTP ${response.status})`)
  }

  get url() { return this.endpoint }
  get authorizationHeader() { return this.proxyToken ? `Bearer ${this.proxyToken}` : undefined }
}

async function readResponse(response: Response): Promise<AgentResponse> {
  try {
    const value: unknown = await response.json()
    if (typeof value !== "object" || value === null) return {}
    const record = value as Record<string, unknown>
    return { endpoint: typeof record.endpoint === "string" ? record.endpoint : undefined, error: typeof record.error === "string" ? record.error : undefined }
  } catch { return {} }
}
