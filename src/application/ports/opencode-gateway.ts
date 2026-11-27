export type RuntimeProject = { directory: string; name?: string }
export type RuntimeSession = { id: string; title?: string; directory?: string; status?: string }
export type RuntimeEvent = { type: string; properties?: Record<string, unknown> }
export type RuntimeMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
  /** Model identity reported by OpenCode for this assistant message, never inferred from its text. */
  model?: { providerID: string; id: string }
}
export type RuntimePermission = { id: string; sessionId: string; title?: string; metadata?: Record<string, unknown> }
export type RuntimeQuestion = { id: string; sessionId: string; questions: Array<{ key?: string; question: string; options?: string[] }> }
export type RuntimeCapabilities = { sessions: true; projects: true; events: true; permissions: true; forms: true; persistentPty?: boolean }

/** Supported OpenCode operations. Implementations live exclusively in the OpenCode adapter. */
export interface OpenCodeGateway {
  health(): Promise<{ connected: boolean; version?: string; reason?: string; capabilities?: RuntimeCapabilities }>
  listProjects(): Promise<RuntimeProject[]>
  createSession(input: { directory: string; title: string; agent?: string; model?: { providerID: string; id: string } }): Promise<RuntimeSession>
  sendPrompt(input: { sessionId: string; text: string }): Promise<void>
  sendFollowUp(input: { sessionId: string; text: string }): Promise<void>
  interrupt(sessionId: string): Promise<void>
  readSession(sessionId: string): Promise<RuntimeSession | undefined>
  readSessionMessages?(sessionId: string): Promise<RuntimeMessage[]>
  listPendingPermissions(sessionId?: string): Promise<RuntimePermission[]>
  replyPermission(input: { permissionId: string; response: "once" | "always" | "reject" }): Promise<void>
  listPendingQuestions(sessionId?: string): Promise<RuntimeQuestion[]>
  replyQuestion(input: { requestId: string; answers: string[][] }): Promise<void>
  subscribeEvents(signal?: AbortSignal): AsyncIterable<RuntimeEvent>
}
