import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify"
import fastifyStatic from "@fastify/static"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { AddressInfo } from "node:net"
import { isAllowedHostHeader, isLoopbackBindHost, isSameOrigin, safeTokenEquals } from "./security"

const SESSION_COOKIE = "foreman_session"
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type BrowserSession = { csrfToken: string; expiresAt: number }

export type ForemanServerOptions = {
  host?: string
  port?: number
  logger?: FastifyServerOptions["logger"]
  staticRoot?: string
  health?: () => unknown
}

export type ForemanServer = {
  app: FastifyInstance
  address: AddressInfo
  url: string
  close(): Promise<void>
}

function createFastify(options: ForemanServerOptions): FastifyInstance {
  const host = options.host ?? "127.0.0.1"
  if (!isLoopbackBindHost(host)) throw new Error("Foreman can bind only to IPv4 or IPv6 loopback addresses")

  const sessions = new Map<string, BrowserSession>()
  const app = fastify({
    logger: options.logger ?? {
      level: "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-csrf-token", "req.body", "res.headers.set-cookie"],
        censor: "[REDACTED]",
      },
    },
    logController: new fastify.LogController({ disableRequestLogging: true }),
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  })

  app.addHook("onRequest", async (request, reply) => {
    const requestHost = request.headers.host
    const localPort = request.raw.socket.localPort ?? 0
    if (!isAllowedHostHeader(requestHost, localPort)) {
      request.log.warn({ requestHost, localPort }, "Rejected Host header")
      return reply.code(403).send({ error: { code: "UNTRUSTED_HOST", message: "This host is not allowed." } })
    }

    const origin = request.headers.origin
    if (origin && !isSameOrigin(origin, requestHost)) {
      return reply.code(403).send({ error: { code: "UNTRUSTED_ORIGIN", message: "Cross-origin requests are not allowed." } })
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      if (!origin || !isSameOrigin(origin, requestHost)) {
        return reply.code(403).send({ error: { code: "ORIGIN_REQUIRED", message: "A same-origin browser request is required." } })
      }
      const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE)
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (!session || session.expiresAt <= Date.now()) {
        if (sessionId) sessions.delete(sessionId)
        return reply.code(403).send({ error: { code: "SESSION_REQUIRED", message: "Refresh the local Foreman session and try again." } })
      }
      const csrfHeader = request.headers["x-csrf-token"]
      if (!safeTokenEquals(session.csrfToken, typeof csrfHeader === "string" ? csrfHeader : undefined)) {
        return reply.code(403).send({ error: { code: "CSRF_INVALID", message: "The request security token is missing or invalid." } })
      }
    }
  })

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff")
    reply.header("x-frame-options", "DENY")
    reply.header("referrer-policy", "no-referrer")
    reply.header("cross-origin-resource-policy", "same-origin")
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()")
    reply.header("content-security-policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'")
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store")
    return payload
  })

  app.setErrorHandler((error, request, reply) => {
    const candidateStatus = error && typeof error === "object" && "statusCode" in error
      ? error.statusCode
      : undefined
    const statusCode = typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus < 500
      ? candidateStatus
      : 500
    if (statusCode >= 500) request.log.error({ requestId: request.id, statusCode }, "Foreman request failed")
    reply.code(statusCode).send({
      error: {
        code: statusCode === 400 ? "INVALID_REQUEST" : statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: statusCode < 500 ? "The request could not be processed." : "An unexpected server error occurred.",
      },
    })
  })

  app.get("/api/health", async () => options.health?.() ?? ({ status: "ok" }))

  app.get("/api/session", async (request, reply) => {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id)
    }
    const existingId = readCookie(request.headers.cookie, SESSION_COOKIE)
    const existing = existingId ? sessions.get(existingId) : undefined
    if (existing && existing.expiresAt > now) return { csrfToken: existing.csrfToken }

    const sessionId = randomBytes(32).toString("base64url")
    const csrfToken = randomBytes(32).toString("base64url")
    sessions.set(sessionId, { csrfToken, expiresAt: now + SESSION_TTL_MS })
    reply.header("set-cookie", `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`)
    return { csrfToken }
  })

  app.delete("/api/session", async (request, reply) => {
    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE)
    if (sessionId) sessions.delete(sessionId)
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
    return reply.code(204).send()
  })

  if (options.staticRoot && existsSync(options.staticRoot)) {
    const root = resolve(options.staticRoot)
    app.register(fastifyStatic, { root, prefix: "/", wildcard: false })
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && request.url !== "/api" && !request.url.startsWith("/api/") && options.staticRoot && existsSync(options.staticRoot)) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html")
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } })
  })

  app.addHook("onClose", async () => {
    sessions.clear()
  })

  return app
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  const prefix = `${name}=`
  const entry = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))
  const value = entry?.slice(prefix.length)
  return value && /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : undefined
}

export async function startForemanServer(options: ForemanServerOptions = {}): Promise<ForemanServer> {
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 0
  const app = createFastify({ ...options, host, port })
  try {
    await app.listen({ host, port })
    const address = app.server.address()
    if (!address || typeof address === "string") throw new Error("Foreman did not receive a TCP listen address")
    const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address
    return {
      app,
      address,
      url: `http://${displayHost}:${address.port}`,
      close: () => app.close(),
    }
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

export type ForemanLoopbackServers = {
  primary: ForemanServer
  ipv6?: ForemanServer
  url: string
  close(): Promise<void>
}

export async function startForemanLoopback(options: Omit<ForemanServerOptions, "host"> = {}): Promise<ForemanLoopbackServers> {
  const primary = await startForemanServer({ ...options, host: "127.0.0.1" })
  let ipv6: ForemanServer | undefined
  try {
    ipv6 = await startForemanServer({ ...options, host: "::1", port: primary.address.port })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined
    if (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL" && code !== "EPROTONOSUPPORT") {
      await primary.close()
      throw error
    }
  }
  return {
    primary,
    ipv6,
    url: primary.url,
    close: async () => {
      await Promise.all([primary.close(), ipv6?.close()])
    },
  }
}
