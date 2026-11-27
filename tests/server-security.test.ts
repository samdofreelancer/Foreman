import { request as httpRequest } from "node:http"
import { createServer } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { startForemanServer, type ForemanServer } from "../src/server/server"

const servers: ForemanServer[] = []

async function requestWithHost(url: string, host: string): Promise<number> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers: { host },
    }, (response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode ?? 0))
    })
    request.once("error", reject)
    request.end()
  })
}

async function start(options: Parameters<typeof startForemanServer>[0] = {}) {
  const server = await startForemanServer({ port: 0, logger: false, ...options })
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe("standalone server security boundary", () => {
  it("binds only to an explicit loopback address", async () => {
    const server = await start({ host: "127.0.0.1" })
    expect(server.address.address).toBe("127.0.0.1")
    expect(server.address.family).toBe("IPv4")
    await expect(startForemanServer({ host: "0.0.0.0" as "127.0.0.1", port: 0, logger: false }))
      .rejects.toThrow(/loopback/i)
  })

  it("supports IPv6 loopback when the host operating system provides it", async () => {
    let server: ForemanServer
    try {
      server = await start({ host: "::1" })
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined
      if (["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(String(code))) return
      throw error
    }
    expect(server.address.family).toBe("IPv6")
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200)
  })

  it("fails clearly when the requested port is already occupied", async () => {
    const occupied = createServer()
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject)
      occupied.listen(0, "127.0.0.1", resolve)
    })
    const address = occupied.address()
    if (!address || typeof address === "string") throw new Error("Expected TCP address")
    try {
      await expect(startForemanServer({ host: "127.0.0.1", port: address.port, logger: false }))
        .rejects.toThrow()
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
  })

  it("rejects untrusted Host values and mismatched browser origins", async () => {
    const server = await start()
    const valid = await fetch(`${server.url}/api/health`)
    expect(valid.status).toBe(200)

    const rebound = await requestWithHost(`${server.url}/api/health`, `attacker.example:${server.address.port}`)
    expect(rebound).toBe(403)

    const crossOrigin = await fetch(`${server.url}/api/health`, { headers: { origin: "http://attacker.example" } })
    expect(crossOrigin.status).toBe(403)
  })

  it("requires a same-origin session and CSRF token for state-changing requests", async () => {
    const server = await start()
    const session = await fetch(`${server.url}/api/session`)
    expect(session.status).toBe(200)
    const payload = await session.json() as { csrfToken: string }
    const cookie = session.headers.get("set-cookie")?.split(";")[0]
    expect(payload.csrfToken).toBeTruthy()
    expect(cookie).toMatch(/^foreman_session=/)

    const missingToken = await fetch(`${server.url}/api/session`, {
      method: "DELETE", headers: { cookie: cookie!, origin: server.url },
    })
    expect(missingToken.status).toBe(403)

    const crossOrigin = await fetch(`${server.url}/api/session`, {
      method: "DELETE",
      headers: { cookie: cookie!, origin: "http://attacker.example", "x-csrf-token": payload.csrfToken },
    })
    expect(crossOrigin.status).toBe(403)

    const sameOrigin = await fetch(`${server.url}/api/session`, {
      method: "DELETE",
      headers: { cookie: cookie!, origin: server.url, "x-csrf-token": payload.csrfToken },
    })
    expect(sameOrigin.status).toBe(204)
  })

  it("sets restrictive browser security headers and does not enable CORS", async () => {
    const server = await start()
    const response = await fetch(`${server.url}/api/health`)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  it("serves built SPA assets and falls back to index for browser routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "foreman-static-"))
    try {
      await writeFile(join(root, "index.html"), "<!doctype html><title>Foreman shell</title>")
      await writeFile(join(root, "app.js"), "globalThis.foremanReady = true")
      const server = await start({ staticRoot: root })
      const asset = await fetch(`${server.url}/app.js`)
      expect(asset.status).toBe(200)
      expect(await asset.text()).toContain("foremanReady")

      const route = await fetch(`${server.url}/board/tasks/123`)
      expect(route.status).toBe(200)
      expect(await route.text()).toContain("Foreman shell")

      const missingApi = await fetch(`${server.url}/api/not-implemented`)
      expect(missingApi.status).toBe(404)
      const apiRoot = await fetch(`${server.url}/api`)
      expect(apiRoot.status).toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
