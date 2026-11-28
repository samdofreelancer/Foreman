import { createServer, request as httpRequest } from "node:http"
import { spawn, execFileSync } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { timingSafeEqual, randomBytes } from "node:crypto"
import { Transform } from "node:stream"

const bindAddress = process.argv[2]
const token = process.env.FOREMAN_HOST_AGENT_TOKEN
if (!bindAddress || !token || token.length < 32) throw new Error("Host agent requires a bind address and a 32-character FOREMAN_HOST_AGENT_TOKEN")

let child
let activePort
let activeCapability
let activeAuthorization
let stopping

function equalToken(candidate) {
  if (typeof candidate !== "string") return false
  const expected = Buffer.from(token)
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function resolveExecutable(configured) {
  if (configured) return configured
  const desktopRoot = process.env.APPDATA && join(process.env.APPDATA, "ai.opencode.desktop", "cli")
  if (desktopRoot && existsSync(desktopRoot)) {
    const candidates = readdirSync(desktopRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^2\.4\.\d+-x64$/i.test(entry.name))
      .map((entry) => join(desktopRoot, entry.name, "opencode-cli.exe"))
      .filter(existsSync)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    if (candidates[0]) return candidates[0]
  }
  const candidates = execFileSync("where.exe", ["opencode"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).filter(Boolean)
  return candidates.find((candidate) => /\.exe$/i.test(candidate)) ?? "opencode"
}

function versionOf(executable) {
  const output = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
  return /(?:opencode\s+v?)?(\d+\.\d+\.\d+)/i.exec(output)?.[1] ?? "unknown"
}

async function freePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not reserve an OpenCode port")
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function stopManaged() {
  const owned = child
  child = undefined
  activePort = undefined
  activeCapability = undefined
  activeAuthorization = undefined
  if (!owned || owned.exitCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => { owned.kill(); resolve() }, 5000)
    owned.once("exit", () => { clearTimeout(timer); resolve() })
    owned.kill("SIGTERM")
  })
}

async function startManaged(input) {
  await stopManaged()
  const executable = resolveExecutable(typeof input.executable === "string" ? input.executable : undefined)
  const version = versionOf(executable)
  if (!/^2\.4\./.test(version)) throw new Error(`OpenCode ${version} is not supported; Foreman requires 2.4.x`)
  const port = await freePort()
  const capability = randomBytes(32).toString("hex")
  const password = randomBytes(32).toString("base64url")
  // OpenCode 2.x currently supports Basic Auth only. Keep that credential
  // entirely inside this Windows process and the loopback-only child server.
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const spawned = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, shell: false, stdio: "ignore",
    env: { ...process.env, OPENCODE_PASSWORD: password, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: undefined },
  })
  child = spawned
  activePort = port
  activeCapability = capability
  activeAuthorization = authorization
  spawned.once("exit", () => { if (child === spawned) { child = undefined; activePort = undefined } })
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (spawned.exitCode !== null) throw new Error(`OpenCode exited during startup (code ${spawned.exitCode})`)
  return { endpoint: "http://host.docker.internal:4320/opencode", token: capability }
}

const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/opencode/")) {
    if (!child || child.exitCode !== null || !activePort) {
      response.writeHead(503).end("Managed OpenCode runtime is not running")
      return
    }
    const suppliedCapability = request.headers.authorization?.replace(/^Bearer\s+/i, "")
    if (!equalCapability(suppliedCapability)) {
      response.writeHead(401, { "cache-control": "no-store" }).end("Unauthorized")
      return
    }
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "GET, HEAD, POST, PUT, PATCH, DELETE" }).end("Method not allowed")
      return
    }
    const upstreamPath = request.url.slice("/opencode".length)
    if (!upstreamPath.startsWith("/") || upstreamPath.startsWith("//") || upstreamPath.includes("\\")) {
      response.writeHead(400).end("Invalid upstream path")
      return
    }
    const safeHeaders = { ...request.headers }
    for (const header of ["authorization", "host", "connection", "proxy-authorization", "proxy-connection", "keep-alive", "transfer-encoding", "upgrade", "origin", "referer", "cookie"]) delete safeHeaders[header]
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: activePort,
      path: upstreamPath,
      method: request.method,
      headers: { ...safeHeaders, authorization: activeAuthorization, host: `127.0.0.1:${activePort}` },
    }, (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers }
      for (const header of ["connection", "keep-alive", "transfer-encoding", "upgrade", "set-cookie"]) delete responseHeaders[header]
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(response)
    })
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502)
      response.end("Managed OpenCode upstream is unavailable")
    })
    let received = 0
    const bodyLimit = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length
      callback(received > 10 * 1024 * 1024 ? new Error("Request body exceeds 10 MiB") : null, chunk)
    } })
    bodyLimit.on("error", () => {
      upstream.destroy()
      if (!response.headersSent) response.writeHead(413)
      response.end("Request body too large")
    })
    request.pipe(bodyLimit).pipe(upstream)
    return
  }
  if (!equalToken(request.headers.authorization?.replace(/^Bearer\s+/i, ""))) {
    response.writeHead(401, { "content-type": "application/json" }).end('{"error":"Unauthorized"}')
    return
  }
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", managed: !!child && child.exitCode === null, port: activePort }))
    return
  }
  if (request.method === "POST" && request.url === "/runtime/start") {
    let raw = ""
    for await (const chunk of request) {
      raw += chunk
      if (raw.length > 8192) { response.writeHead(413).end(); return }
    }
    try {
      const result = await startManaged(JSON.parse(raw || "{}"))
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 240) : "OpenCode startup failed" }))
    }
    return
  }
  if (request.method === "POST" && request.url === "/runtime/stop") {
    await stopManaged()
    response.writeHead(200, { "content-type": "application/json" }).end('{"stopped":true}')
    return
  }
  response.writeHead(404).end()
})

server.listen(4320, bindAddress)
server.on("error", (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
process.once("SIGINT", async () => { await stopManaged(); server.close() })
process.once("SIGTERM", async () => { await stopManaged(); server.close() })
process.stdout.write(`Foreman OpenCode host agent listening on ${bindAddress}:4320\n`)

function equalCapability(candidate) {
  if (typeof candidate !== "string" || !activeCapability) return false
  const expected = Buffer.from(activeCapability)
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
