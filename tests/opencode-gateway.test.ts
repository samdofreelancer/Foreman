import { describe, expect, it, vi } from "vitest"
import { createOpenCodeClient, OpenCodeGatewayAdapter, validateOpenCodeEndpoint } from "../src/adapters/opencode/gateway"

function fakeClient() {
  return {
    server: { info: vi.fn().mockResolvedValue({ version: "2.4.2" }) },
    project: { list: vi.fn().mockResolvedValue([{ canonical: "C:\\work\\demo", name: "demo" }]) },
    session: {
      create: vi.fn().mockResolvedValue({ id: "ses-1", title: "Build", location: { directory: "C:\\work\\demo" } }),
      prompt: vi.fn().mockResolvedValue({}),
      interrupt: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ id: "ses-1", title: "Build", location: { directory: "C:\\work\\demo" }, time: { idle: 1 } }),
      context: vi.fn().mockResolvedValue([
        { id: "msg-user", type: "user", text: "Run the migrations", time: { created: 10 } },
        { id: "msg-assistant", type: "assistant", model: { providerID: "anthropic", id: "claude-sonnet-4-5" }, content: [{ type: "text", text: "Migrations passed." }, { type: "tool", name: "test", id: "tool-1", state: { status: "completed", input: {}, content: [] }, time: { created: 11 } }], time: { created: 11 } },
      ]),
      form: {
        list: vi.fn().mockResolvedValue([{ id: "form-1", sessionID: "ses-1", title: "Choose", fields: [{ key: "approval", title: "Approve", type: "string" }] }]),
        get: vi.fn().mockResolvedValue({ id: "form-1", sessionID: "ses-1", title: "Choose", fields: [{ key: "approval", title: "Approve", type: "string" }], state: {} }),
        reply: vi.fn().mockResolvedValue(undefined),
      },
    },
    permission: {
      list: vi.fn().mockResolvedValue([{ id: "perm-1", sessionID: "ses-1", action: "write", resources: [] }]),
      reply: vi.fn().mockResolvedValue(undefined),
      request: { list: vi.fn().mockResolvedValue({ data: [{ id: "perm-1", sessionID: "ses-1", action: "write", resources: [] }] }) },
    },
    form: { list: vi.fn().mockResolvedValue({ data: [{ id: "form-1", sessionID: "ses-1" }] }) },
    event: { subscribe: vi.fn(() => (async function* () {
      yield { type: "session.idle", data: { sessionID: "ses-1", text: "private transcript" } }
      yield { type: "session.text.delta", data: { sessionID: "ses-1", assistantMessageID: "msg-live", ordinal: 0, delta: "Visible streamed answer" } }
    })()) },
  }
}

describe("OpenCodeGatewayAdapter", () => {
  it("reports compatible server version and explicit unsupported versions", async () => {
    const client = fakeClient()
    const gateway = new OpenCodeGatewayAdapter(client as never)
    expect(await gateway.health()).toMatchObject({ connected: true, version: "2.4.2", capabilities: { sessions: true, projects: true, events: true, permissions: true, forms: true } })
    client.server.info.mockResolvedValue({ version: "1.19.6" })
    expect(await gateway.health()).toMatchObject({ connected: false, version: "1.19.6", reason: expect.stringContaining("not supported") })
  })

  it("maps projects, session lifecycle, prompt, follow-up and interrupt", async () => {
    const client = fakeClient()
    const gateway = new OpenCodeGatewayAdapter(client as never)
    expect(await gateway.listProjects()).toEqual([{ directory: "C:\\work\\demo", name: "demo" }])
    expect(await gateway.createSession({ directory: "C:\\work\\demo", title: "Build", agent: "build", model: { providerID: "anthropic", id: "sonnet" } })).toMatchObject({ id: "ses-1" })
    expect(client.session.create).toHaveBeenCalledWith({ title: "Build", agent: "build", model: { providerID: "anthropic", id: "sonnet" }, location: { directory: "C:\\work\\demo" } })
    await gateway.sendPrompt({ sessionId: "ses-1", text: "Start" })
    await gateway.sendFollowUp({ sessionId: "ses-1", text: "Continue" })
    await gateway.interrupt("ses-1")
    expect(client.session.prompt).toHaveBeenNthCalledWith(1, { sessionID: "ses-1", text: "Start" })
    expect(client.session.prompt).toHaveBeenNthCalledWith(2, { sessionID: "ses-1", text: "Continue", delivery: "queue" })
    expect(client.session.interrupt).toHaveBeenCalledWith({ sessionID: "ses-1" })
    expect(await gateway.readSession("ses-1")).toMatchObject({ id: "ses-1" })
  })

  it("reads user and assistant text from the supported OpenCode session context API", async () => {
    const client = fakeClient()
    const gateway = new OpenCodeGatewayAdapter(client as never)
    expect(await gateway.readSessionMessages("ses-1")).toEqual([
      { id: "msg-user", role: "user", text: "Run the migrations", createdAt: 10 },
      { id: "msg-assistant", role: "assistant", text: "Migrations passed.", createdAt: 11, model: { providerID: "anthropic", id: "claude-sonnet-4-5" } },
    ])
    expect(client.session.context).toHaveBeenCalledWith({ sessionID: "ses-1" })
  })

  it("treats a typed SessionNotFoundError as a missing session, not a transport failure", async () => {
    const client = fakeClient()
    client.session.get.mockRejectedValue(Object.assign(new Error("Session not found"), { _tag: "SessionNotFoundError" }))
    const gateway = new OpenCodeGatewayAdapter(client as never)
    await expect(gateway.readSession("ses_missing")).resolves.toBeUndefined()
  })

  it("maps permissions and forms without auto-approving or auto-answering", async () => {
    const client = fakeClient()
    const gateway = new OpenCodeGatewayAdapter(client as never)
    expect(await gateway.listPendingPermissions("ses-1")).toMatchObject([{ id: "perm-1", sessionId: "ses-1" }])
    await gateway.replyPermission({ permissionId: "perm-1", response: "once" })
    expect(client.permission.reply).toHaveBeenCalledWith({ sessionID: "ses-1", requestID: "perm-1", decision: "once" })
    expect(await gateway.listPendingQuestions("ses-1")).toMatchObject([{ id: "form-1", sessionId: "ses-1" }])
    await gateway.replyQuestion({ requestId: "form-1", answers: [["yes"]] })
    expect(client.session.form.reply).toHaveBeenCalledWith({ sessionID: "ses-1", formID: "form-1", answer: { approval: ["yes"] } })
  })

  it("exposes the typed event iterable and maps its envelope", async () => {
    const client = fakeClient()
    const gateway = new OpenCodeGatewayAdapter(client as never)
    const events = gateway.subscribeEvents()
    const iterator = events[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ value: { type: "session.idle", properties: { sessionID: "ses-1" } }, done: false })
    expect(await iterator.next()).toMatchObject({ value: { type: "session.text.delta", properties: { sessionID: "ses-1", assistantMessageID: "msg-live", delta: "Visible streamed answer" } }, done: false })
    expect(await iterator.next()).toMatchObject({ done: true })
  })
})

describe("validateOpenCodeEndpoint", () => {
  it("accepts HTTP(S) endpoints without embedded credentials", () => {
    expect(validateOpenCodeEndpoint("http://127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
    expect(validateOpenCodeEndpoint("https://opencode.example.com")).toBe("https://opencode.example.com")
  })

  it.each(["file:///tmp/opencode", "http://user:pass@localhost:4096", "not a url", "ftp://localhost"]) (
    "rejects unsafe endpoint %s", (value) => expect(() => validateOpenCodeEndpoint(value)).toThrow(),
  )

  it("requires TLS before sending credentials to a non-loopback server", () => {
    expect(() => createOpenCodeClient("http://opencode.example.test", { password: "secret" })).toThrow("require HTTPS")
    expect(() => createOpenCodeClient("http://127.0.0.1:4096", { password: "secret" })).not.toThrow()
  })
})
