import { OpenCode } from "@opencode/client"
import type { OpenCodeClient } from "@opencode/client"
import type {
  OpenCodeGateway, RuntimeCapabilities, RuntimeEvent, RuntimeMessage, RuntimePermission, RuntimeProject, RuntimeQuestion, RuntimeSession,
} from "../../application/ports/opencode-gateway"

export type OpenCodeCredentials = { username?: string; password?: string }

export function validateOpenCodeEndpoint(value: string): string {
  const url = new URL(value)
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("OpenCode endpoint must use HTTP or HTTPS")
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the OpenCode endpoint URL")
  if (url.search || url.hash) throw new Error("OpenCode endpoint must not contain a query string or fragment")
  return url.toString().replace(/\/$/, "")
}

export function createOpenCodeClient(endpoint: string, credentials?: OpenCodeCredentials, authorizationHeader?: string): OpenCodeClient {
  const baseUrl = validateOpenCodeEndpoint(endpoint)
  const parsed = new URL(baseUrl)
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]"
  if (credentials?.password && parsed.protocol !== "https:" && !loopback) {
    throw new Error("OpenCode credentials require HTTPS for non-loopback endpoints")
  }
  const headers = authorizationHeader
    ? { Authorization: authorizationHeader }
    : credentials?.password
      ? { Authorization: `Basic ${Buffer.from(`${credentials.username ?? "opencode"}:${credentials.password}`).toString("base64")}` }
      : undefined
  return OpenCode.make({ baseUrl, headers })
}

export class OpenCodeGatewayAdapter implements OpenCodeGateway {
  constructor(private readonly client: OpenCodeClient) {}

  async health(): Promise<{ connected: boolean; version?: string; reason?: string; capabilities?: RuntimeCapabilities }> {
    try {
      const info = await this.client.server.info()
      if (!/^2\.4\./.test(info.version)) return { connected: false, version: info.version, reason: `OpenCode ${info.version} is not supported; Foreman requires 2.4.x` }
      const capabilities: RuntimeCapabilities = { sessions: true, projects: true, events: true, permissions: true, forms: true, persistentPty: info.capabilities?.persistentPty }
      return {
        connected: true,
        version: info.version,
        capabilities,
      }
    } catch (error) {
      return { connected: false, reason: safeError(error) }
    }
  }

  async listProjects(): Promise<RuntimeProject[]> {
    return (await this.client.project.list()).map((project) => ({ directory: project.canonical, name: project.name ?? undefined }))
  }

  async createSession(input: { directory: string; title: string; agent?: string; model?: { providerID: string; id: string } }): Promise<RuntimeSession> {
    const session = await this.client.session.create({ title: input.title, agent: input.agent, model: input.model, location: { directory: input.directory } })
    return mapSession(session)
  }

  async sendPrompt(input: { sessionId: string; text: string }) {
    await this.client.session.prompt({ sessionID: input.sessionId, text: input.text })
  }

  async sendFollowUp(input: { sessionId: string; text: string }) {
    await this.client.session.prompt({ sessionID: input.sessionId, text: input.text, delivery: "queue" })
  }

  async interrupt(sessionId: string) {
    await this.client.session.interrupt({ sessionID: sessionId })
  }

  async readSession(sessionId: string): Promise<RuntimeSession | undefined> {
    try { return mapSession(await this.client.session.get({ sessionID: sessionId })) }
    catch (error) {
      if (statusCode(error) === 404) return undefined
      throw error
    }
  }

  async readSessionMessages(sessionId: string): Promise<RuntimeMessage[]> {
    const messages = await this.client.session.context({ sessionID: sessionId })
    return messages.flatMap((message): RuntimeMessage[] => {
      if (message.type === "user") return [{ id: message.id, role: "user", text: message.text, createdAt: message.time.created }]
      if (message.type === "assistant") {
        const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim()
        return text ? [{
          id: message.id, role: "assistant", text, createdAt: message.time.created,
          model: { providerID: message.model.providerID, id: message.model.id },
        }] : []
      }
      return []
    })
  }

  async listPendingPermissions(sessionId?: string): Promise<RuntimePermission[]> {
    if (!sessionId) return []
    return (await this.client.permission.list({ sessionID: sessionId })).map((item) => ({
      id: item.id, sessionId: item.sessionID, title: item.action,
      metadata: { resources: item.resources, message: item.message },
    }))
  }

  async replyPermission(input: { permissionId: string; response: "once" | "always" | "reject" }) {
    const pending = await this.client.permission.request.list()
    const match = pending.data.find((item) => item.id === input.permissionId)
    if (!match) throw new Error("Permission request is no longer pending")
    await this.client.permission.reply({ sessionID: match.sessionID, requestID: input.permissionId, decision: input.response })
  }

  async listPendingQuestions(sessionId?: string): Promise<RuntimeQuestion[]> {
    if (!sessionId) return []
    const forms = await this.client.session.form.list({ sessionID: sessionId })
    return forms.map((form) => ({
      id: form.id, sessionId: form.sessionID,
      questions: form.fields.map((field) => ({ key: field.key, question: field.title ?? field.key, options: "options" in field ? field.options?.map((option) => option.label) : undefined })),
    }))
  }

  async replyQuestion(input: { requestId: string; answers: string[][] }) {
    const pending = await this.client.form.list()
    const match = pending.data.find((item) => item.id === input.requestId)
    if (!match) throw new Error("Form request is no longer pending")
    const detail = await this.client.session.form.get({ sessionID: match.sessionID, formID: input.requestId })
    const answer = Object.fromEntries(input.answers.map((value, index) => [detail.fields[index]?.key ?? String(index), value]))
    await this.client.session.form.reply({ sessionID: match.sessionID, formID: input.requestId, answer })
  }

  subscribeEvents(signal?: AbortSignal): AsyncIterable<RuntimeEvent> {
    const source = this.client.event.subscribe({ signal })
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of source) {
          if (!safeEventTypes.has(event.type)) continue
          const payload = "data" in event ? event.data : undefined
          yield { type: event.type, properties: sanitizeEventPayload(payload, event.type) }
        }
      },
    }
  }
}

function mapSession(session: Awaited<ReturnType<OpenCodeClient["session"]["get"]>>): RuntimeSession {
  return { id: session.id, title: session.title, directory: session.location?.directory, status: session.outcome ?? (session.time?.busy ? "busy" : session.time?.idle ? "idle" : undefined) }
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const candidate = error as { status?: number; statusCode?: number; _tag?: string }
  if (candidate._tag === "SessionNotFoundError") return 404
  return candidate.status ?? candidate.statusCode
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/(authorization|password|token)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 240) : "OpenCode connection failed"
}

const safeEventTypes = new Set([
  "server.connected", "project.updated", "session.created", "session.deleted", "session.renamed",
  "session.metadata.updated", "session.execution.started", "session.execution.succeeded",
  "session.execution.failed", "session.execution.interrupted", "session.idle", "session.status",
  "session.step.started", "session.step.first-token", "session.step.ended", "session.step.failed",
  "session.text.delta", "session.tool.input.started", "session.tool.success", "session.tool.failed",
  "session.retry.scheduled",
  "permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled",
])
const forbiddenEventKeys = /^(text|content|transcript|prompt|token|password|authorization|secret|body|delta|message)$/i
function sanitizeEventPayload(value: unknown, type: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  const assistantMessageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined
  if (type === "session.text.delta") {
    return sessionID && assistantMessageID && typeof data.delta === "string"
      ? { sessionID, assistantMessageID, ordinal: data.ordinal, delta: data.delta.slice(0, 8_000) }
      : undefined
  }
  if (type === "session.tool.input.started") {
    return sessionID && typeof data.id === "string" && typeof data.name === "string"
      ? { sessionID, assistantMessageID, id: data.id, name: data.name.slice(0, 100) }
      : undefined
  }
  if (["session.tool.success", "session.tool.failed"].includes(type)) {
    return sessionID && typeof data.id === "string" ? { sessionID, assistantMessageID, id: data.id } : undefined
  }
  if (type.startsWith("session.step.")) {
    return sessionID && assistantMessageID
      ? { sessionID, assistantMessageID, ...(typeof data.finish === "string" ? { finish: data.finish } : {}) }
      : undefined
  }
  if (type === "session.retry.scheduled") {
    return sessionID && assistantMessageID && typeof data.at === "number"
      ? { sessionID, assistantMessageID, attempt: data.attempt, at: data.at }
      : undefined
  }
  return sanitizeObject(value, 0) as Record<string, unknown>
}

function sanitizeObject(value: unknown, depth: number): unknown {
  if (depth > 4) return undefined
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeObject(item, depth + 1))
  if (typeof value === "string") return value.slice(0, 2_000)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenEventKeys.test(key))
    .map(([key, item]) => [key, sanitizeObject(item, depth + 1)]))
}
