import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify"
import fastifyStatic from "@fastify/static"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { AddressInfo } from "node:net"
import { isAllowedBindHost, isAllowedHostHeader, isSameOrigin, safeTokenEquals } from "./security"
import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import { createTask, updateTask, type TaskInput, type TaskPatch, type TaskColumn } from "../domain/task"
import { createProject, updateProject } from "../domain/project"
import { createActivityEvent } from "../domain/activity"
import type { TaskRepository, ProjectRepository, ActivityRepository } from "../application/ports/repositories"
import type { TaskExecutionService } from "../application/task-execution"
import type { ForemanRuntimeController, RuntimeConnectInput } from "./runtime-controller"
import { InboxService } from "../application/inbox"
import type { ForemanBackupManager } from "../adapters/persistence/sqlite/backup-manager"

const SESSION_COOKIE = "foreman_session"
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type BrowserSession = { csrfToken: string; expiresAt: number }

export type ForemanServerOptions = {
  host?: string
  port?: number
  logger?: FastifyServerOptions["logger"]
  staticRoot?: string
  health?: () => unknown
  repositories?: { tasks: TaskRepository; projects: ProjectRepository; activities: ActivityRepository; transaction?: <T>(operation: () => T) => T }
  execution?: TaskExecutionService
  runtime?: ForemanRuntimeController
  backup?: ForemanBackupManager
}

export type ForemanServer = {
  app: FastifyInstance
  address: AddressInfo
  url: string
  close(): Promise<void>
}

function createFastify(options: ForemanServerOptions): FastifyInstance {
  const host = options.host ?? "127.0.0.1"
  if (!isAllowedBindHost(host)) throw new Error("Foreman can bind to loopback addresses only unless container binding is explicitly enabled")

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
  app.addContentTypeParser("application/vnd.foreman.backup", { parseAs: "buffer", bodyLimit: 256 * 1024 * 1024 }, (_request, body, done) => done(null, body))

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

  if (options.repositories) registerWorkspaceApi(app, options.repositories, options.execution, options.runtime, options.backup)

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
    // wildcard: true resolves files from disk on every request, so a client rebuild that
    // emits new content-hashed asset names is served without restarting the server.
    app.register(fastifyStatic, { root, prefix: "/", wildcard: true, index: ["index.html"] })
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && request.url !== "/api" && !request.url.startsWith("/api/") && options.staticRoot && existsSync(options.staticRoot)) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html")
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } })
  })

  app.addHook("onClose", async () => {
    sessions.clear()
    await options.runtime?.close()
  })

  return app
}

function registerWorkspaceApi(
  app: FastifyInstance,
  repositories: NonNullable<ForemanServerOptions["repositories"]>,
  execution?: TaskExecutionService,
  runtime?: ForemanRuntimeController,
  backup?: ForemanBackupManager,
) {
  const { tasks, projects, activities } = repositories
  const transaction = repositories.transaction ?? (<T>(operation: () => T) => operation())
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  const appendActivity = (type: string, summary: string, taskId?: string, projectId?: string) => {
    activities.append(createActivityEvent({ type, summary, taskId, projectId }, Date.now(), randomUUID()))
  }
  const fail = (reply: import("fastify").FastifyReply, status: number, code: string, message: string) =>
    reply.code(status).send({ error: { code, message } })

  if (backup) {
    app.get("/api/backup", async (_request, reply) => {
      try {
        const archive = await backup.createBackup()
        return reply.header("content-type", "application/vnd.foreman.backup")
          .header("content-disposition", `attachment; filename="foreman-backup-${new Date().toISOString().replaceAll(":", "-")}.fbackup"`)
          .header("content-length", archive.byteLength)
          .send(archive)
      } catch { return fail(reply, 500, "BACKUP_FAILED", "Foreman could not create a verified backup. Your current database was not changed.") }
    })
    app.post("/api/backup/preview", async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) return fail(reply, 400, "INVALID_BACKUP", "Upload a Foreman backup file to preview restore.")
      try { return { preview: backup.previewRestore(request.body) } }
      catch (error) { return fail(reply, 400, "BACKUP_INVALID", error instanceof Error ? error.message : "Backup validation failed.") }
    })
    app.post("/api/backup/restore", async (request, reply) => {
      if (!record(request.body) || typeof request.body.token !== "string") return fail(reply, 400, "RESTORE_CONFIRMATION_REQUIRED", "Confirm the current restore preview before replacing Foreman data.")
      if (runtime?.status.status === "connected" || runtime?.status.status === "stale") return fail(reply, 409, "RUNTIME_MUST_BE_DISCONNECTED", "Disconnect OpenCode before restoring Foreman data. Backup files never contain OpenCode sessions or transcripts.")
      if (tasks.list().some((task) => task.column === "doing")) return fail(reply, 409, "TASK_EXECUTION_ACTIVE", "A task is still marked Doing. Wait for execution to finish or reconcile it before restoring.")
      try { return { result: backup.confirmRestore(request.body.token) } }
      catch (error) { return fail(reply, 409, "RESTORE_FAILED", error instanceof Error ? error.message : "Restore could not be completed.") }
    })
  }

  const inbox = new InboxService({
    tasks,
    gateway: () => runtime?.activeGateway,
    runtimeStatus: () => runtime?.status.status ?? "disconnected",
  })
  app.get("/api/inbox", async () => ({ items: await inbox.list() }))
  app.post<{ Params: { id: string } }>("/api/inbox/permissions/:id/reply", async (request, reply) => {
    if (!record(request.body) || !["once", "always", "reject"].includes(String(request.body.response))) return fail(reply, 400, "INVALID_PERMISSION_RESPONSE", "Choose once, always, or reject.")
    try {
      await inbox.replyPermission(request.params.id, request.body.response as "once" | "always" | "reject")
      return { resolved: true }
    } catch (error) { return fail(reply, 409, "PERMISSION_REPLY_REJECTED", error instanceof Error ? error.message : "Permission could not be resolved.") }
  })
  app.post<{ Params: { id: string } }>("/api/inbox/questions/:id/reply", async (request, reply) => {
    if (!record(request.body) || !Array.isArray(request.body.answers) || request.body.answers.length > 50
      || request.body.answers.some((answer) => !Array.isArray(answer) || answer.length > 20 || answer.some((value) => typeof value !== "string" || value.length > 2_000))) return fail(reply, 400, "INVALID_QUESTION_RESPONSE", "Provide valid answers for the requested questions.")
    try {
      await inbox.replyQuestion(request.params.id, request.body.answers as string[][])
      return { resolved: true }
    } catch (error) { return fail(reply, 409, "QUESTION_REPLY_REJECTED", error instanceof Error ? error.message : "Question could not be answered.") }
  })

  app.get("/api/runtime", async () => ({ runtime: runtime?.status ?? { status: "disconnected" }, settings: runtime?.settings }))
  app.post("/api/runtime/connect", async (request, reply) => {
    if (!runtime) return fail(reply, 503, "RUNTIME_UNAVAILABLE", "Runtime connection is not configured in this Foreman process.")
    if (!record(request.body)) return fail(reply, 400, "INVALID_RUNTIME_CONFIG", "Runtime connection settings are required.")
    const body = request.body
    let input: RuntimeConnectInput
    if (body.mode === "managed") {
      if (body.executable !== undefined && (typeof body.executable !== "string" || body.executable.length > 4_096)) return fail(reply, 400, "INVALID_RUNTIME_CONFIG", "OpenCode executable path is invalid.")
      input = { mode: "managed", executable: typeof body.executable === "string" ? body.executable : undefined }
    } else if (body.mode === "external") {
      if (typeof body.endpoint !== "string" || body.endpoint.length > 2_048
        || (body.username !== undefined && (typeof body.username !== "string" || body.username.length > 256))
        || (body.password !== undefined && (typeof body.password !== "string" || body.password.length > 4_096))) {
        return fail(reply, 400, "INVALID_RUNTIME_CONFIG", "A valid OpenCode endpoint and optional credentials are required.")
      }
      input = { mode: "external", endpoint: body.endpoint, username: body.username as string | undefined, password: body.password as string | undefined }
    } else return fail(reply, 400, "INVALID_RUNTIME_CONFIG", "Runtime mode must be managed or external.")
    try { return { runtime: await runtime.connect(input) } }
    catch (error) { return fail(reply, 400, "RUNTIME_CONNECT_FAILED", error instanceof Error ? error.message.slice(0, 240) : "OpenCode connection failed.") }
  })
  app.post("/api/runtime/disconnect", async (_request, reply) => {
    if (!runtime) return fail(reply, 503, "RUNTIME_UNAVAILABLE", "Runtime connection is not configured.")
    await runtime.disconnect()
    return reply.code(200).send({ runtime: runtime.status })
  })
  app.post("/api/runtime/reconnect", async (_request, reply) => {
    if (!runtime) return fail(reply, 503, "RUNTIME_UNAVAILABLE", "Runtime connection is not configured.")
    try { return { runtime: await runtime.reconnect() } }
    catch (error) { return fail(reply, 409, "RUNTIME_RECONNECT_FAILED", error instanceof Error ? error.message.slice(0, 240) : "OpenCode could not be reconnected.") }
  })

  if (execution) {
    app.post<{ Params: { id: string } }>("/api/tasks/:id/start", async (request, reply) => {
      const result = await execution.start(request.params.id)
      if (result.kind === "rejected") return fail(reply, 409, "TASK_START_REJECTED", result.reason)
      return reply.code(200).send({ result })
    })
    app.post<{ Params: { id: string } }>("/api/tasks/:id/resend", async (request, reply) => {
      const result = await execution.resendInitialPrompt(request.params.id)
      if (result.kind === "rejected") return fail(reply, 409, "PROMPT_RESEND_REJECTED", result.reason)
      return reply.code(200).send({ result })
    })
    app.post<{ Params: { id: string } }>("/api/tasks/:id/follow-up", async (request, reply) => {
      if (!record(request.body) || typeof request.body.text !== "string") return fail(reply, 400, "INVALID_FOLLOW_UP", "Follow-up text is required.")
      const result = await execution.followUp(request.params.id, request.body.text)
      if (result.kind === "rejected") return fail(reply, 409, "FOLLOW_UP_REJECTED", result.reason)
      return reply.code(200).send({ result })
    })
  }

  app.post<{ Params: { id: string } }>("/api/tasks/:id/recover-start", async (request, reply) => {
    const task = tasks.getById(request.params.id)
    if (!task) return fail(reply, 404, "TASK_NOT_FOUND", "Task not found.")
    if (!task.startPending || task.sessionID) return fail(reply, 409, "START_RECOVERY_NOT_AVAILABLE", "This task has no unresolved session-creation claim.")
    if (!record(request.body) || request.body.confirmedNoSession !== true) {
      return fail(reply, 400, "START_RECOVERY_CONFIRMATION_REQUIRED", "Confirm that you inspected OpenCode and no session was created.")
    }
    const cleared = transaction(() => {
      if (!tasks.clearStartClaim(task.id)) return false
      appendActivity("task.execution.start-claim-cleared", `Cleared an uncertain start claim after user verification: ${task.title}`, task.id)
      return true
    })
    if (!cleared) return fail(reply, 409, "START_RECOVERY_NOT_AVAILABLE", "The start claim changed before recovery could be applied.")
    return { task: tasks.getById(task.id) }
  })

  app.get("/api/tasks", async () => ({ tasks: tasks.list() }))
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const task = tasks.getById(request.params.id)
    if (!task) return fail(reply, 404, "TASK_NOT_FOUND", "Task not found.")
    const gateway = runtime?.activeGateway
    const messages = task.sessionID && gateway?.readSessionMessages
      ? await gateway.readSessionMessages(task.sessionID)
      : []
    return { task, activity: activities.listForTask(task.id), messages }
  })
  app.get<{ Params: { id: string } }>("/api/tasks/:id/events", async (request, reply) => {
    const task = tasks.getById(request.params.id)
    if (!task) return fail(reply, 404, "TASK_NOT_FOUND", "Task not found.")
    if (!task.sessionID || !runtime?.subscribeEvents) return fail(reply, 409, "TASK_SESSION_UNAVAILABLE", "This task has no live OpenCode session.")
    reply.hijack()
    const response = reply.raw
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })
    response.write(`event: ready\ndata: ${JSON.stringify({ taskId: task.id })}\n\n`)
    const unsubscribe = runtime.subscribeEvents((event) => {
      const properties = event.properties ?? {}
      if (properties.sessionID !== task.sessionID) return
      response.write(`event: progress\ndata: ${JSON.stringify({ type: event.type, properties })}\n\n`)
    })
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15_000)
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe() })
  })
  app.post("/api/tasks", async (request, reply) => {
    if (!record(request.body)) return fail(reply, 400, "INVALID_TASK", "A task object is required.")
    const body = request.body as Record<string, unknown>
    if (typeof body.title !== "string" || typeof body.projectDirectory !== "string") {
      return fail(reply, 400, "INVALID_TASK", "Task title and absolute project directory are required.")
    }
    const input: TaskInput = {
      title: body.title,
      projectDirectory: body.projectDirectory,
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.projectName === "string" ? { projectName: body.projectName } : {}),
      ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
      ...(record(body.model) && typeof body.model.providerID === "string" && typeof body.model.id === "string"
        ? { model: { providerID: body.model.providerID, id: body.model.id } } : {}),
    }
    try {
      const task = transaction(() => {
        const created = createTask(input, Date.now(), randomUUID())
        let project = projects.getByDirectory(created.projectDirectory)
        if (!project) {
          project = createProject({ name: created.projectName || basename(created.projectDirectory.replace(/[\\/]+$/, "")) || created.projectDirectory, directory: created.projectDirectory }, Date.now(), randomUUID())
          projects.create(project)
        }
        tasks.create(created)
        appendActivity("task.created", `Created task: ${created.title}`, created.id, project.id)
        return created
      })
      return reply.code(201).send({ task })
    } catch (error) {
      return fail(reply, 400, "INVALID_TASK", error instanceof Error ? error.message : "Task could not be created.")
    }
  })
  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const existing = tasks.getById(request.params.id)
    if (!existing) return fail(reply, 404, "TASK_NOT_FOUND", "Task not found.")
    if (!record(request.body)) return fail(reply, 400, "INVALID_TASK", "A task update object is required.")
    const body = request.body
    const patch: TaskPatch = {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.description === "string" || body.description === null ? { description: body.description ?? undefined } : {}),
      ...(typeof body.projectDirectory === "string" ? { projectDirectory: body.projectDirectory } : {}),
      ...(typeof body.projectName === "string" || body.projectName === null ? { projectName: body.projectName ?? undefined } : {}),
      ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
      ...(body.column === "todo" || body.column === "ready" || body.column === "doing" || body.column === "done" ? { column: body.column as TaskColumn } : {}),
      ...(record(body.model) && typeof body.model.providerID === "string" && typeof body.model.id === "string"
        ? { model: { providerID: body.model.providerID, id: body.model.id } } : {}),
    }
    try {
      const updated = transaction(() => {
        const next = updateTask(existing, patch, Date.now())
        if (next.projectDirectory !== existing.projectDirectory && !projects.getByDirectory(next.projectDirectory)) {
          const project = createProject({ name: next.projectName || basename(next.projectDirectory), directory: next.projectDirectory }, Date.now(), randomUUID())
          projects.create(project)
        }
        tasks.update(next)
        appendActivity("task.updated", `Updated task: ${next.title}`, next.id)
        return next
      })
      return { task: updated }
    } catch (error) {
      return fail(reply, 400, "INVALID_TASK_UPDATE", error instanceof Error ? error.message : "Task could not be updated.")
    }
  })
  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const task = tasks.getById(request.params.id)
    if (!task) return fail(reply, 404, "TASK_NOT_FOUND", "Task not found.")
    if (task.sessionID || task.startPending) return fail(reply, 409, "TASK_EXECUTION_LINKED", "A task with an OpenCode session or pending start claim cannot be deleted.")
    transaction(() => {
      appendActivity("task.deleted", `Deleted task: ${task.title}`, task.id)
      tasks.delete(task.id)
    })
    return reply.code(204).send()
  })

  app.get("/api/projects", async () => {
    const known = new Map(projects.list().map((project) => [project.directory.toLocaleLowerCase(), project]))
    for (const task of tasks.list()) {
      const key = task.projectDirectory.toLocaleLowerCase()
      if (!known.has(key)) known.set(key, { id: `local:${key}`, name: task.projectName || basename(task.projectDirectory), directory: task.projectDirectory, createdAt: task.createdAt, updatedAt: task.updatedAt })
    }
    return { projects: [...known.values()].sort((a, b) => a.name.localeCompare(b.name)) }
  })
  app.get("/api/projects/discover", async (_request, reply) => {
    const gateway = runtime?.activeGateway
    if (!gateway) return fail(reply, 409, "RUNTIME_NOT_CONNECTED", "Connect a healthy OpenCode 2.4.x runtime to discover its projects.")
    try { return { projects: await gateway.listProjects() } }
    catch (error) { return fail(reply, 503, "PROJECT_DISCOVERY_FAILED", error instanceof Error ? error.message.slice(0, 240) : "OpenCode projects could not be discovered.") }
  })
  app.post("/api/projects/import", async (request, reply) => {
    if (!record(request.body) || typeof request.body.directory !== "string") return fail(reply, 400, "INVALID_PROJECT", "Choose a project discovered from OpenCode.")
    const requestedDirectory = request.body.directory
    const gateway = runtime?.activeGateway
    if (!gateway) return fail(reply, 409, "RUNTIME_NOT_CONNECTED", "Connect OpenCode before importing a discovered project.")
    try {
      const discovered = await gateway.listProjects()
      const match = discovered.find((project) => project.directory === requestedDirectory)
      if (!match) return fail(reply, 404, "RUNTIME_PROJECT_NOT_FOUND", "This project is no longer available from OpenCode. Refresh discovery.")
      const existing = projects.getByDirectory(match.directory)
      if (existing) return { project: existing, imported: false }
      const project = transaction(() => {
        const created = createProject({ name: match.name || basename(match.directory), directory: match.directory }, Date.now(), randomUUID())
        projects.create(created)
        appendActivity("project.imported-from-opencode", `Imported OpenCode project: ${created.name}`, undefined, created.id)
        return created
      })
      return reply.code(201).send({ project, imported: true })
    } catch (error) { return fail(reply, 400, "PROJECT_IMPORT_FAILED", error instanceof Error ? error.message.slice(0, 240) : "Project could not be imported.") }
  })
  app.post("/api/projects", async (request, reply) => {
    if (!record(request.body) || typeof request.body.name !== "string" || typeof request.body.directory !== "string") {
      return fail(reply, 400, "INVALID_PROJECT", "Project name and absolute directory are required.")
    }
    const body = request.body
    try {
      const project = transaction(() => {
        const created = createProject({ name: body.name as string, directory: body.directory as string }, Date.now(), randomUUID())
        projects.create(created)
        appendActivity("project.created", `Added project: ${created.name}`, undefined, created.id)
        return created
      })
      return reply.code(201).send({ project })
    } catch (error) {
      return fail(reply, 400, "INVALID_PROJECT", error instanceof Error ? error.message : "Project could not be created.")
    }
  })
  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const project = projects.getById(request.params.id)
    if (!project) return fail(reply, 404, "PROJECT_NOT_FOUND", "Project not found.")
    if (!record(request.body)) return fail(reply, 400, "INVALID_PROJECT", "A project update is required.")
    const body = request.body as Record<string, unknown>
    try {
      const updated = transaction(() => {
        const next = updateProject(project, {
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.directory === "string" ? { directory: body.directory } : {}),
        }, Date.now())
        projects.update(next)
        appendActivity("project.updated", `Updated project: ${next.name}`, undefined, next.id)
        return next
      })
      return { project: updated }
    } catch (error) {
      return fail(reply, 400, "INVALID_PROJECT_UPDATE", error instanceof Error ? error.message : "Project could not be updated.")
    }
  })
  app.get("/api/activity", async () => ({ activities: activities.listRecent(100) }))
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

export async function startForemanLoopback(options: Omit<ForemanServerOptions, "host"> & { host?: string } = {}): Promise<ForemanLoopbackServers> {
  const { host, ...serverOptions } = options
  const primary = await startForemanServer({ ...serverOptions, host: host ?? "127.0.0.1" })
  // Container deployments bind inside the isolated container network. Compose must publish
  // that port only on a private host interface; public exposure is never configured here.
  if (host && host !== "127.0.0.1" && host !== "::1") {
    return { primary, url: primary.url, close: () => primary.close() }
  }
  let ipv6: ForemanServer | undefined
  try {
    ipv6 = await startForemanServer({ ...serverOptions, host: "::1", port: primary.address.port })
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
