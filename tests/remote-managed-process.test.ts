import { describe, expect, it, vi } from "vitest"
import { RemoteManagedOpenCodeProcess } from "../src/adapters/opencode/remote-managed-process"

describe("RemoteManagedOpenCodeProcess", () => {
  it("asks the Windows host agent to start OpenCode and validates the returned endpoint", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ endpoint: "http://host.docker.internal:4320/opencode", token: "d".repeat(64) }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
    const healthCheck = vi.fn().mockResolvedValue(true)
    const managed = new RemoteManagedOpenCodeProcess({ baseUrl: "http://host.docker.internal:4320/", token: "a".repeat(64), request })

    await expect(managed.start({ username: "opencode", password: "secret", healthCheck })).resolves.toBe("http://host.docker.internal:4320/opencode")
    expect(request).toHaveBeenCalledWith("http://host.docker.internal:4320/runtime/start", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ authorization: `Bearer ${"a".repeat(64)}` }), body: "{}",
    }))
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({})
    expect(managed.authorizationHeader).toBe(`Bearer ${"d".repeat(64)}`)
    expect(healthCheck).toHaveBeenCalledWith("http://host.docker.internal:4320/opencode")
    await managed.stop()
    expect(request).toHaveBeenLastCalledWith("http://host.docker.internal:4320/runtime/stop", expect.objectContaining({ method: "POST" }))
    expect(managed.authorizationHeader).toBeUndefined()
  })

  it("stops a server when its OpenCode health check fails", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ endpoint: "http://host.docker.internal:4320/opencode", token: "e".repeat(64) }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
    const managed = new RemoteManagedOpenCodeProcess({ baseUrl: "http://host.docker.internal:4320", token: "b".repeat(64), request })

    await expect(managed.start({ username: "opencode", password: "secret", healthCheck: async () => false })).rejects.toThrow("did not become healthy")
    expect(request).toHaveBeenLastCalledWith("http://host.docker.internal:4320/runtime/stop", expect.any(Object))
  })

  it("fails closed when the host agent token is missing", async () => {
    const request = vi.fn()
    const managed = new RemoteManagedOpenCodeProcess({ baseUrl: "http://host.docker.internal:4320", token: "", request })
    await expect(managed.start({ username: "opencode", password: "secret", healthCheck: async () => true })).rejects.toThrow("FOREMAN_HOST_AGENT_TOKEN is not configured")
    expect(request).not.toHaveBeenCalled()
  })
})
