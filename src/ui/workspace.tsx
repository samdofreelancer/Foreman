import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { applyTaskFilters, normalizeProjectDirectory } from "../domain/filters"
import { groupTasks } from "../domain/columns"
import type { Task, TaskColumn } from "../domain/task"
import type { Project } from "../domain/project"
import type { ActivityEvent } from "../domain/activity"
import type { AttentionItem } from "../application/inbox"
import type { AppRoute } from "./routes"

type RuntimeView = { status: "connected" | "stale" | "connecting" | "disconnected"; mode?: "managed" | "external"; version?: string; reason?: string; sessionBaseUrl?: string }
type SavedRuntimeSettings = { mode: "managed" | "external"; endpoint?: string; executable?: string; username?: string; credentialRequired: boolean; autoConnect: boolean; updatedAt: number }
type HealthView = { status: "ok" | "degraded"; server?: { status: string; uptimeSeconds: number; nodeVersion: string }; database?: { status: string; schemaVersion: number; message?: string }; runtime?: RuntimeView }
type BackupPreview = { token: string; manifest: { createdAt: string; schemaVersion: number; databaseBytes: number }; counts: { tasks: number; projects: number; activities: number } }
type TaskMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: number; model?: { providerID: string; id: string } }
type Props = { route: AppRoute; csrfToken: string; onNavigate(path: AppRoute): void; onRuntimeChange(status: RuntimeView): void; onInboxCountChange(count: number): void }
const columns: Array<{ id: TaskColumn; label: string; hint: string }> = [
  { id: "todo", label: "Todo", hint: "Ideas and upcoming work" },
  { id: "ready", label: "Ready", hint: "Prepared to execute" },
  { id: "doing", label: "Doing", hint: "Controlled by OpenCode" },
  { id: "done", label: "Done", hint: "Completed work" },
]

async function request<T>(path: string, csrf: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { "x-csrf-token": csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    const message = payload && typeof payload === "object" && "error" in payload
      && payload.error && typeof payload.error === "object" && "message" in payload.error
      && typeof payload.error.message === "string" ? payload.error.message : `Request failed (${response.status})`
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function projectLabel(task: Task) {
  return task.projectName || task.projectDirectory.split(/[\\/]/).filter(Boolean).at(-1) || task.projectDirectory
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value)
}

type InlinePart = { type: "text" | "strong" | "emphasis" | "strike" | "code" | "link"; value: string; href?: string }
type MarkdownBlock = { type: "paragraph" | "heading" | "quote" | "code" | "unordered-list" | "ordered-list" | "rule"; text?: string; level?: number; language?: string; items?: string[] }

function parseInlineMarkdown(source: string): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g
  let offset = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset) parts.push({ type: "text", value: source.slice(offset, index) })
    const token = match[0]
    if (token.startsWith("**") || token.startsWith("__")) parts.push({ type: "strong", value: token.slice(2, -2) })
    else if (token.startsWith("~~")) parts.push({ type: "strike", value: token.slice(2, -2) })
    else if (token.startsWith("`")) parts.push({ type: "code", value: token.slice(1, -1) })
    else if (token.startsWith("*") || token.startsWith("_")) parts.push({ type: "emphasis", value: token.slice(1, -1) })
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) parts.push({ type: "link", value: link[1], href: link[2] })
      else parts.push({ type: "text", value: token })
    }
    offset = index + token.length
  }
  if (offset < source.length) parts.push({ type: "text", value: source.slice(offset) })
  return parts
}

function parseMessageMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index++
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push({ type: "code", text: code.join("\n"), language })
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); index++; continue }
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { blocks.push({ type: "rule" }); index++; continue }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""))
      blocks.push({ type: "quote", text: quote.join("\n") }); continue
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      const type = unordered ? "unordered-list" : "ordered-list"
      const items: string[] = []
      while (index < lines.length) {
        const item = type === "unordered-list" ? /^\s*[-*+]\s+(.+)$/.exec(lines[index]) : /^\s*\d+[.)]\s+(.+)$/.exec(lines[index])
        if (!item) break
        items.push(item[1]); index++
      }
      blocks.push({ type, items }); continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*(---+|___+|\*\*\*+)\s*$)/.test(lines[index])) paragraph.push(lines[index++])
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") })
    else { blocks.push({ type: "paragraph", text: lines[index] }); index++ }
  }
  return blocks
}

function safeMarkdownHref(href: string): string | undefined {
  try {
    const url = new URL(href)
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

function renderInlineMarkdown(source: string) {
  return parseInlineMarkdown(source).map((part) => {
    if (part.type === "strong") return <strong>{part.value}</strong>
    if (part.type === "emphasis") return <em>{part.value}</em>
    if (part.type === "strike") return <del>{part.value}</del>
    if (part.type === "code") return <code class="message-inline-code">{part.value}</code>
    if (part.type === "link") {
      const href = safeMarkdownHref(part.href ?? "")
      return href ? <a href={href} target="_blank" rel="noreferrer">{part.value}</a> : <span>{part.value}</span>
    }
    return <span>{part.value}</span>
  })
}

function MessageMarkdown(props: { source: string }) {
  return <div class="message-markdown"><For each={parseMessageMarkdown(props.source)}>{(block) => {
    if (block.type === "heading") return <h4 class={`message-heading message-heading-${block.level}`}>{renderInlineMarkdown(block.text ?? "")}</h4>
    if (block.type === "quote") return <blockquote>{renderInlineMarkdown(block.text ?? "")}</blockquote>
    if (block.type === "code") return <div class="message-code"><Show when={block.language}><span class="message-code-language">{block.language}</span></Show><pre><code>{block.text}</code></pre></div>
    if (block.type === "unordered-list") return <ul><For each={block.items}>{(item) => <li>{renderInlineMarkdown(item)}</li>}</For></ul>
    if (block.type === "ordered-list") return <ol><For each={block.items}>{(item) => <li>{renderInlineMarkdown(item)}</li>}</For></ol>
    if (block.type === "rule") return <hr />
    return <p>{renderInlineMarkdown(block.text ?? "")}</p>
  }}</For></div>
}

function executionLabel(task: Task, runtime: RuntimeView) {
  if (!task.sessionID) return task.startPending ? "Unknown · inspect OpenCode before retrying" : "Not started"
  if (task.initialPromptState === "pending") return "Unknown · initial prompt delivery was interrupted"
  if (task.initialPromptState === "failed") return "Failed · initial prompt needs resend"
  if (task.lastError) return "Failed / attention required"
  if (task.column === "done") return "Succeeded"
  if (runtime.status === "stale") return "Stale · reconnecting to OpenCode"
  if (runtime.status !== "connected") return "Disconnected · session link retained"
  return "Session linked · OpenCode connected"
}

export function Workspace(props: Props) {
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [projects, setProjects] = createSignal<Project[]>([])
  const [activities, setActivities] = createSignal<ActivityEvent[]>([])
  const [inboxItems, setInboxItems] = createSignal<AttentionItem[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [projectFilter, setProjectFilter] = createSignal("")
  const [selected, setSelected] = createSignal<Task | undefined>()
  const [editing, setEditing] = createSignal(false)
  const [showCreate, setShowCreate] = createSignal(false)
  const [dragged, setDragged] = createSignal<string | undefined>()
  const [formTitle, setFormTitle] = createSignal("")
  const [formDescription, setFormDescription] = createSignal("")
  const [formProject, setFormProject] = createSignal("")
  const [formProjectName, setFormProjectName] = createSignal("")
  const [formAgent, setFormAgent] = createSignal("build")
  const [formProvider, setFormProvider] = createSignal("")
  const [formModel, setFormModel] = createSignal("")
  const [projectName, setProjectName] = createSignal("")
  const [projectDirectory, setProjectDirectory] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [runtimeBusy, setRuntimeBusy] = createSignal(false)
  const [runtimeStatus, setRuntimeStatus] = createSignal<RuntimeView>({ status: "disconnected" })
  const [runtimeMode, setRuntimeMode] = createSignal<"managed" | "external">("managed")
  const [runtimeExecutable, setRuntimeExecutable] = createSignal("")
  const [runtimeEndpoint, setRuntimeEndpoint] = createSignal("http://127.0.0.1:4096")
  const [runtimeUsername, setRuntimeUsername] = createSignal("opencode")
  const [runtimePassword, setRuntimePassword] = createSignal("")
  const [savedRuntimeSettings, setSavedRuntimeSettings] = createSignal<SavedRuntimeSettings | undefined>()
  const [healthInfo, setHealthInfo] = createSignal<HealthView>()
  const [discoveredProjects, setDiscoveredProjects] = createSignal<Array<{ directory: string; name?: string }>>([])
  const [discoveryBusy, setDiscoveryBusy] = createSignal(false)
  const [backupBusy, setBackupBusy] = createSignal(false)
  const [backupNotice, setBackupNotice] = createSignal("")
  const [restorePreview, setRestorePreview] = createSignal<BackupPreview>()
  const [followUpText, setFollowUpText] = createSignal("")
  const [taskMessages, setTaskMessages] = createSignal<TaskMessage[]>([])
  const [liveProgress, setLiveProgress] = createSignal("")
  const [liveProgressActive, setLiveProgressActive] = createSignal(false)
  const [liveExecutionStarted, setLiveExecutionStarted] = createSignal(false)
  const [liveMessage, setLiveMessage] = createSignal<{ id: string; text: string; createdAt: number }>()

  const jumpToLatestMessage = (behavior: ScrollBehavior = "smooth") => {
    const conversation = document.querySelector<HTMLElement>(".conversation-scroll")
    if (conversation) conversation.scrollTo({ top: conversation.scrollHeight, behavior })
  }

  const scheduleLatestMessageScroll = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => jumpToLatestMessage("instant")))
  }

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    setSelected(undefined)
    setEditing(false)
    setShowCreate(false)
  }
  window.addEventListener("keydown", handleEscape)
  onCleanup(() => window.removeEventListener("keydown", handleEscape))

  createEffect(() => {
    const modalOpen = !!selected() || showCreate() || editing()
    if (!modalOpen) return
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = "hidden"
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    onCleanup(() => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    })
  })

  const refresh = async () => {
    setLoading(true)
    setError("")
    try {
      const [taskResult, projectResult, activityResult, runtimeResult, healthResult] = await Promise.all([
        request<{ tasks: Task[] }>("/api/tasks", props.csrfToken),
        request<{ projects: Project[] }>("/api/projects", props.csrfToken),
        request<{ activities: ActivityEvent[] }>("/api/activity", props.csrfToken),
        request<{ runtime: RuntimeView; settings?: SavedRuntimeSettings }>("/api/runtime", props.csrfToken),
        request<HealthView>("/api/health", props.csrfToken),
      ])
      setTasks(taskResult.tasks)
      setProjects(projectResult.projects)
      setActivities(activityResult.activities)
      setRuntimeStatus(runtimeResult.runtime)
      setSavedRuntimeSettings(runtimeResult.settings)
      setHealthInfo(healthResult)
      if (runtimeResult.settings) {
        setRuntimeMode(runtimeResult.settings.mode)
        setRuntimeExecutable(runtimeResult.settings.executable ?? "")
        setRuntimeEndpoint(runtimeResult.settings.endpoint ?? "http://127.0.0.1:4096")
        setRuntimeUsername(runtimeResult.settings.username ?? "opencode")
      }
      props.onRuntimeChange(runtimeResult.runtime)
      if (projectFilter() && !projectResult.projects.some((project) => normalizeProjectDirectory(project.directory) === normalizeProjectDirectory(projectFilter()))) setProjectFilter("")
      if (selected()) setSelected(taskResult.tasks.find((task) => task.id === selected()!.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workspace data.")
    } finally { setLoading(false) }
  }
  void refresh()

  const refreshOperationalStatus = async () => {
    try {
      const [runtimeResult, healthResult] = await Promise.all([
        request<{ runtime: RuntimeView; settings?: SavedRuntimeSettings }>("/api/runtime", props.csrfToken),
        request<HealthView>("/api/health", props.csrfToken),
      ])
      setRuntimeStatus(runtimeResult.runtime); props.onRuntimeChange(runtimeResult.runtime)
      setSavedRuntimeSettings(runtimeResult.settings); setHealthInfo(healthResult)
    } catch { /* the shell's local-server health indicator handles server loss */ }
  }
  createEffect(() => {
    const task = selected()
    if (!task?.sessionID) { setTaskMessages([]); setLiveProgress(""); setLiveProgressActive(false); setLiveMessage(undefined); return }
    let active = true
    let initialConversationLoaded = false
    const stream = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/events`)
    stream.addEventListener("progress", (raw) => {
      if (!active) return
      try {
        const event = JSON.parse((raw as MessageEvent<string>).data) as { type: string; properties?: Record<string, unknown> }
        const properties = event.properties ?? {}
        const messageId = typeof properties.assistantMessageID === "string" ? properties.assistantMessageID : undefined
        if (event.type === "session.execution.started") { setLiveExecutionStarted(true); setLiveProgress("OpenCode đã bắt đầu xử lý · đang khởi động…"); setLiveProgressActive(true) }
        else if (event.type === "session.step.started") { setLiveExecutionStarted(true); setLiveProgress("OpenCode đang phân tích và xử lý yêu cầu…"); setLiveProgressActive(true) }
        else if (event.type === "session.text.delta" && messageId && typeof properties.delta === "string") {
          setLiveExecutionStarted(true)
          setLiveProgress("Đang tạo câu trả lời…")
          setLiveProgressActive(true)
          setLiveMessage((current) => current?.id === messageId
            ? { ...current, text: current.text + properties.delta as string }
            : { id: messageId, text: properties.delta as string, createdAt: Date.now() })
          scheduleLatestMessageScroll()
        } else if (event.type === "session.tool.input.started") {
          setLiveExecutionStarted(true)
          setLiveProgress(`Đang chạy công cụ: ${typeof properties.name === "string" ? properties.name : "tool"}…`)
          setLiveProgressActive(true)
        } else if (event.type === "session.tool.success") { setLiveProgress("Công cụ đã hoàn thành · OpenCode đang tiếp tục…"); setLiveProgressActive(true) }
        else if (event.type === "session.tool.failed") { setLiveProgress("Một công cụ gặp lỗi · OpenCode đang xử lý…"); setLiveProgressActive(true) }
        else if (event.type === "session.retry.scheduled") { setLiveProgress("OpenCode đang thử lại sau sự cố tạm thời…"); setLiveProgressActive(true) }
        else if (event.type === "session.step.ended") { setLiveProgress("Đang hoàn thiện kết quả…"); setLiveProgressActive(true) }
        else if (event.type === "session.execution.succeeded" || event.type === "session.idle") {
          setLiveProgress("Đã hoàn tất · đang đồng bộ lịch sử…")
          void loadConversation().finally(() => { setLiveProgress("Đã nhận phản hồi từ OpenCode."); setLiveProgressActive(false) })
        } else if (event.type === "session.execution.failed") { setLiveProgress("OpenCode kết thúc với lỗi."); setLiveProgressActive(false) }
        else if (event.type === "session.execution.interrupted") { setLiveProgress("OpenCode đã dừng thực thi."); setLiveProgressActive(false) }
      } catch { /* Ignore malformed events; the persisted conversation remains authoritative. */ }
    })
    stream.onerror = () => { if (active && stream.readyState === EventSource.CONNECTING) { setLiveProgress("Mất kết nối cập nhật trực tiếp · đang kết nối lại…"); setLiveProgressActive(true) } }
    const loadConversation = async () => {
      try {
        const detail = await request<{ task: Task; messages: TaskMessage[]; activity: ActivityEvent[] }>(`/api/tasks/${task.id}`, props.csrfToken)
        if (!active) return
        setTaskMessages(detail.messages)
        if (liveMessage() && detail.messages.some((message) => message.id === liveMessage()!.id)) setLiveMessage(undefined)
        if (!initialConversationLoaded) {
          initialConversationLoaded = true
          scheduleLatestMessageScroll()
        }
        if (task.updatedAt !== detail.task.updatedAt || task.column !== detail.task.column || task.lastError !== detail.task.lastError) {
          setSelected(detail.task)
        }
        setTasks((current) => current.map((item) => item.id === detail.task.id ? detail.task : item))
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "OpenCode conversation could not be loaded.")
      }
    }
    void loadConversation()
    const interval = window.setInterval(() => void loadConversation(), 3_000)
    const runtimeInterval = window.setInterval(() => {
      void request<{ runtime: RuntimeView }>("/api/runtime", props.csrfToken).then(({ runtime }) => {
        if (active && runtime.status !== "connected" && liveProgressActive()) {
          setLiveProgress("OpenCode đã mất kết nối · kiểm tra lại runtime trong Settings.")
          setLiveProgressActive(false)
        }
      }).catch(() => {
        if (active && liveProgressActive()) {
          setLiveProgress("Không thể xác nhận kết nối OpenCode · đang thử kết nối lại…")
          setLiveProgressActive(false)
        }
      })
    }, 5_000)
    onCleanup(() => { active = false; stream.close(); window.clearInterval(interval); window.clearInterval(runtimeInterval) })
  })
  createEffect(() => {
    if (props.route !== "/settings") return
    void refreshOperationalStatus()
    const interval = window.setInterval(() => void refreshOperationalStatus(), 5_000)
    onCleanup(() => window.clearInterval(interval))
  })

  const discoverRuntimeProjects = async () => {
    setDiscoveryBusy(true); setError("")
    try {
      const result = await request<{ projects: Array<{ directory: string; name?: string }> }>("/api/projects/discover", props.csrfToken)
      setDiscoveredProjects(result.projects)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "OpenCode projects could not be discovered.") }
    finally { setDiscoveryBusy(false) }
  }
  createEffect(() => { if (props.route === "/projects" && runtimeStatus().status === "connected") void discoverRuntimeProjects() })
  const importRuntimeProject = async (directory: string) => {
    setDiscoveryBusy(true); setError("")
    try { await request("/api/projects/import", props.csrfToken, "POST", { directory }); await refresh(); await discoverRuntimeProjects() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Project could not be imported.") }
    finally { setDiscoveryBusy(false) }
  }

  const loadInbox = async () => {
    try {
      const result = await request<{ items: AttentionItem[] }>("/api/inbox", props.csrfToken)
      setInboxItems(result.items)
      props.onInboxCountChange(result.items.length)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inbox could not be loaded.") }
  }
  createEffect(() => {
    if (props.route !== "/inbox") return
    void loadInbox()
    const interval = window.setInterval(() => void loadInbox(), 5_000)
    onCleanup(() => window.clearInterval(interval))
  })

  const respondPermission = async (id: string, response: "once" | "always" | "reject") => {
    setRuntimeBusy(true); setError("")
    try { await request(`/api/inbox/permissions/${encodeURIComponent(id)}/reply`, props.csrfToken, "POST", { response }); await loadInbox(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Permission response failed.") }
    finally { setRuntimeBusy(false) }
  }
  const respondQuestion = async (event: SubmitEvent, item: Extract<AttentionItem, { kind: "question" }>) => {
    event.preventDefault()
    const fields = Array.from((event.currentTarget as HTMLFormElement).querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-answer]"))
    setRuntimeBusy(true); setError("")
    try {
      await request(`/api/inbox/questions/${encodeURIComponent(item.question.id)}/reply`, props.csrfToken, "POST", { answers: fields.map((field) => [field.value]) })
      await loadInbox(); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Question response failed.") }
    finally { setRuntimeBusy(false) }
  }
  const openAttentionTask = (item: AttentionItem) => {
    setSelected(tasks().find((task) => task.id === item.task.id))
    props.onNavigate("/board")
  }

  const filteredTasks = createMemo(() => applyTaskFilters(tasks(), projectFilter() || undefined, query()))
  const grouped = createMemo(() => groupTasks(filteredTasks()))
  const resetTaskForm = (task?: Task) => {
    setFormTitle(task?.title ?? "")
    setFormDescription(task?.description ?? "")
    setFormProject(task?.projectDirectory ?? (projectFilter() || projects()[0]?.directory || ""))
    setFormProjectName(task?.projectName ?? projects().find((project) => project.directory === (task?.projectDirectory ?? formProject()))?.name ?? "")
    setFormAgent(task?.agent ?? "build")
    setFormProvider(task?.model?.providerID ?? "")
    setFormModel(task?.model?.id ?? "")
  }
  const openCreate = () => { resetTaskForm(); setSelected(undefined); setShowCreate(true) }
  const openEdit = () => { if (!selected()) return; resetTaskForm(selected()); setEditing(true) }
  const saveTask = async (event: SubmitEvent) => {
    event.preventDefault()
    setSaving(true); setError("")
    try {
      const body = {
        title: formTitle(), description: formDescription(), projectDirectory: formProject(),
        projectName: formProjectName(), agent: formAgent(),
        ...(formProvider().trim() && formModel().trim() ? { model: { providerID: formProvider().trim(), id: formModel().trim() } } : {}),
      }
      if (editing() && selected()) {
        await request(`/api/tasks/${selected()!.id}`, props.csrfToken, "PATCH", body)
      } else {
        await request("/api/tasks", props.csrfToken, "POST", body)
      }
      setEditing(false); setShowCreate(false); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task could not be saved.") }
    finally { setSaving(false) }
  }
  const moveTask = async (task: Task, column: TaskColumn) => {
    if (column === "doing" || column === task.column) return
    try {
      await request(`/api/tasks/${task.id}`, props.csrfToken, "PATCH", { column })
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task status could not be changed.") }
  }
  const deleteSelected = async () => {
    const task = selected()
    if (!task || !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return
    try { await request(`/api/tasks/${task.id}`, props.csrfToken, "DELETE"); setSelected(undefined); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Task could not be deleted.") }
  }
  const saveProject = async (event: SubmitEvent) => {
    event.preventDefault(); setSaving(true); setError("")
    try {
      await request("/api/projects", props.csrfToken, "POST", { name: projectName(), directory: projectDirectory() })
      setProjectName(""); setProjectDirectory(""); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project could not be added.") }
    finally { setSaving(false) }
  }

  const connectRuntime = async (event: SubmitEvent) => {
    event.preventDefault(); setRuntimeBusy(true); setError("")
    try {
      const body = runtimeMode() === "managed"
        ? { mode: "managed", executable: runtimeExecutable() }
        : { mode: "external", endpoint: runtimeEndpoint(), username: runtimeUsername(), password: runtimePassword() }
      const result = await request<{ runtime: RuntimeView }>("/api/runtime/connect", props.csrfToken, "POST", body)
      setRuntimeStatus(result.runtime); props.onRuntimeChange(result.runtime); setRuntimePassword("")
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "OpenCode could not be connected.") }
    finally { setRuntimeBusy(false) }
  }
  const disconnectRuntime = async () => {
    setRuntimeBusy(true); setError("")
    try {
      const result = await request<{ runtime: RuntimeView }>("/api/runtime/disconnect", props.csrfToken, "POST")
      setRuntimeStatus(result.runtime); props.onRuntimeChange(result.runtime); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "OpenCode could not be disconnected.") }
    finally { setRuntimeBusy(false) }
  }
  const reconnectRuntime = async () => {
    setRuntimeBusy(true); setError("")
    try {
      const result = await request<{ runtime: RuntimeView }>("/api/runtime/reconnect", props.csrfToken, "POST", {})
      setRuntimeStatus(result.runtime); props.onRuntimeChange(result.runtime); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "OpenCode could not be reconnected.") }
    finally { setRuntimeBusy(false) }
  }
  const downloadBackup = async () => {
    setBackupBusy(true); setError(""); setBackupNotice("")
    try {
      const response = await fetch("/api/backup", { credentials: "same-origin", headers: { accept: "application/vnd.foreman.backup" } })
      if (!response.ok) throw new Error(`Backup failed (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url; link.download = `foreman-backup-${new Date().toISOString().replaceAll(":", "-")}.fbackup`
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url)
      setBackupNotice("Verified backup downloaded. Keep it somewhere separate from this computer.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backup could not be created.") }
    finally { setBackupBusy(false) }
  }
  const previewBackupRestore = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    setBackupBusy(true); setError(""); setBackupNotice(""); setRestorePreview(undefined)
    try {
      const response = await fetch("/api/backup/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/vnd.foreman.backup", "x-csrf-token": props.csrfToken }, body: file })
      const payload = await response.json() as { preview?: BackupPreview; error?: { message?: string } }
      if (!response.ok || !payload.preview) throw new Error(payload.error?.message || `Restore preview failed (${response.status})`)
      setRestorePreview(payload.preview)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backup could not be validated.") }
    finally { setBackupBusy(false); input.value = "" }
  }
  const confirmBackupRestore = async () => {
    const preview = restorePreview()
    if (!preview) return
    const confirmed = window.confirm(`Restore this backup from ${new Date(preview.manifest.createdAt).toLocaleString()}?\n\nIt will replace all current Foreman tasks, projects and activity. ${preview.counts.tasks} tasks, ${preview.counts.projects} projects and ${preview.counts.activities} activity records will be restored. OpenCode connection settings are not included. Disconnect OpenCode and ensure no task is actively running before continuing.`)
    if (!confirmed) return
    setBackupBusy(true); setError(""); setBackupNotice("")
    try {
      await request("/api/backup/restore", props.csrfToken, "POST", { token: preview.token })
      setRestorePreview(undefined)
      setBackupNotice("Restore completed. Your previous database was retained as a rollback copy.")
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Restore could not be completed.") }
    finally { setBackupBusy(false) }
  }
  const startSelected = async () => {
    const task = selected(); if (!task) return
    setRuntimeBusy(true); setError("")
    try {
      const { result } = await request<{ result: { kind: string; error?: string } }>(`/api/tasks/${task.id}/start`, props.csrfToken, "POST", {})
      if (result.kind === "prompt-failed") setError(`Session created, but the initial prompt failed: ${result.error}. Use Resend prompt to retry in the same session.`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task could not be started.") }
    finally { setRuntimeBusy(false) }
  }
  const recoverStartClaim = async () => {
    const task = selected()
    if (!task?.startPending || !window.confirm("Only continue after inspecting OpenCode and confirming that no session was created. Clear this reservation so the task can be started again?")) return
    setRuntimeBusy(true); setError("")
    try {
      await request(`/api/tasks/${task.id}/recover-start`, props.csrfToken, "POST", { confirmedNoSession: true })
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Start recovery could not be completed.") }
    finally { setRuntimeBusy(false) }
  }
  const resendPrompt = async () => {
    const task = selected(); if (!task) return
    setRuntimeBusy(true); setError("")
    try {
      const { result } = await request<{ result: { kind: string; error?: string } }>(`/api/tasks/${task.id}/resend`, props.csrfToken, "POST", {})
      if (result.kind === "prompt-failed") setError(`Prompt resend failed: ${result.error}`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prompt could not be resent.") }
    finally { setRuntimeBusy(false) }
  }
  const sendFollowUp = async (event: SubmitEvent) => {
    event.preventDefault()
    const task = selected(); if (!task || !followUpText().trim()) return
    const text = followUpText().trim()
    setRuntimeBusy(true); setError("")
    setLiveMessage(undefined)
    setLiveExecutionStarted(false)
    setLiveProgress("Đang gửi yêu cầu tới OpenCode…")
    setLiveProgressActive(true)
    try {
      await request(`/api/tasks/${task.id}/follow-up`, props.csrfToken, "POST", { text })
      if (!liveExecutionStarted()) setLiveProgress("Đã gửi yêu cầu · đang chờ OpenCode bắt đầu xử lý…")
      setFollowUpText("")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Follow-up could not be sent."
      setLiveProgress(`Không thể gửi yêu cầu: ${message}`)
      setLiveProgressActive(false)
      setError(message)
    }
    finally { setRuntimeBusy(false) }
  }

  const heading = () => props.route === "/board" ? "Board" : props.route === "/projects" ? "Projects" : props.route === "/activity" ? "Activity" : props.route === "/inbox" ? "Inbox" : "Settings"
  return <>
    <div class="page-heading">
      <div><p class="eyebrow">LOCAL WORKSPACE</p><h1>{heading()}</h1><p class="page-description">{props.route === "/board" ? "Plan and track work by task, not by chat session." : props.route === "/projects" ? "Projects are local folders that organize your tasks." : props.route === "/activity" ? "A safe, local history of changes in your workspace." : props.route === "/inbox" ? "Runtime attention items will appear here when execution is connected." : "Configure how Foreman works on this machine."}</p></div>
      <Show when={props.route === "/board"}><div class="heading-actions"><span class="runtime-pill"><span class={`status-dot ${runtimeStatus().status === "connected" ? "status-online" : "status-muted"}`}/>{runtimeStatus().status === "connected" ? `OpenCode ${runtimeStatus().version ?? "connected"}` : `OpenCode ${runtimeStatus().status}`}</span><Show when={runtimeStatus().status !== "connected"}><button class="button button-quiet" onClick={() => props.onNavigate("/settings")}>Connect</button></Show><button class="button button-primary" onClick={openCreate}>＋ New task</button></div></Show>
    </div>
    <Show when={error()}><div class="workspace-alert" role="alert"><span>{error()}</span><button class="icon-button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div></Show>
    <Show when={loading()}><div class="workspace-state" aria-live="polite"><div class="loader"/><p>Loading your workspace…</p></div></Show>
    <Show when={!loading() && props.route === "/board"}>
      <section class="board-toolbar" aria-label="Board filters">
        <label class="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search tasks" placeholder="Search tasks…" value={query()} onInput={(event) => setQuery(event.currentTarget.value)}/></label>
        <label class="filter-field"><span>Project</span><select aria-label="Filter by project" value={projectFilter()} onChange={(event) => setProjectFilter(event.currentTarget.value)}><option value="">All projects</option><For each={projects()}>{(project) => <option value={project.directory}>{project.name}</option>}</For></select></label>
        <span class="board-total">{filteredTasks().length} {filteredTasks().length === 1 ? "task" : "tasks"}</span>
      </section>
      <Show when={tasks().length === 0}><section class="workspace-empty"><div class="empty-symbol">＋</div><h2>Your board starts with a task</h2><p>Create a task and choose the local project it belongs to. You can organize work while OpenCode is disconnected.</p><button class="button button-primary" onClick={openCreate}>Create your first task</button></section></Show>
      <Show when={tasks().length > 0 && filteredTasks().length === 0}><section class="workspace-empty compact"><h2>No matching tasks</h2><p>Try another search term or clear the project filter.</p><button class="text-button" onClick={() => { setQuery(""); setProjectFilter("") }}>Clear filters</button></section></Show>
      <Show when={filteredTasks().length > 0}>
        <section class="kanban-board" aria-label="Task board">
          <For each={columns}>{(column) => <section class="kanban-column" aria-label={`${column.label} column`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const task = tasks().find((item) => item.id === dragged()); if (task) void moveTask(task, column.id); setDragged(undefined) }}>
            <header class="kanban-column-head"><div><span class={`column-dot dot-${column.id}`}/><h2>{column.label}</h2><span class="column-count">{grouped()[column.id].length}</span></div><p>{column.hint}</p></header>
            <div class="kanban-cards"><For each={grouped()[column.id]}>{(task) => <article class="task-card" draggable={column.id !== "doing"} onDragStart={() => setDragged(task.id)} onDragEnd={() => setDragged(undefined)}>
              <button class="task-card-open" onClick={() => { setSelected(task); setEditing(false) }}><span class="task-project">{projectLabel(task)}</span><strong>{task.title}</strong><Show when={task.description}><p>{task.description}</p></Show><span class="task-card-meta"><span>{task.agent || "build"}</span><span>{formatDate(task.updatedAt)}</span></span></button>
              <label class="task-move-label"><span class="sr-only">Move {task.title}</span><select aria-label={`Move ${task.title}`} disabled={task.column === "doing"} value={task.column} onChange={(event) => void moveTask(task, event.currentTarget.value as TaskColumn)}><option value="todo">Todo</option><option value="ready">Ready</option><option value="doing" disabled>Doing · runtime</option><option value="done">Done</option></select></label>
            </article>}</For><Show when={grouped()[column.id].length === 0}><div class="column-empty">No tasks</div></Show></div>
            <Show when={column.id === "todo"}><button class="add-task-inline" onClick={openCreate}>＋ Add task</button></Show>
          </section>}</For>
        </section>
      </Show>
    </Show>

    <Show when={!loading() && props.route === "/projects"}>
      <Show when={runtimeStatus().status === "connected"}><section class="runtime-project-panel"><div class="section-heading"><div><h2>Discover from OpenCode</h2><p>Projects known to the connected OpenCode runtime. Importing registers a local Foreman project; it does not modify OpenCode.</p></div><button class="button button-quiet" disabled={discoveryBusy()} onClick={() => void discoverRuntimeProjects()}>{discoveryBusy() ? "Refreshing…" : "Refresh"}</button></div><Show when={discoveredProjects().length === 0}><p class="form-note">No projects were returned by OpenCode.</p></Show><For each={discoveredProjects()}>{(project) => { const registered = projects().some((item) => normalizeProjectDirectory(item.directory) === normalizeProjectDirectory(project.directory)); return <div class="discovered-project-row"><div><strong>{project.name || project.directory.split(/[\\/]/).filter(Boolean).at(-1) || project.directory}</strong><span>{project.directory}</span></div><button class="button button-quiet" disabled={registered || discoveryBusy()} onClick={() => void importRuntimeProject(project.directory)}>{registered ? "Added" : "Add to Foreman"}</button></div> }}</For></section></Show>
      <section class="project-create-panel"><form onSubmit={saveProject}><div><h2>Add a local project</h2><p>Register a project folder to use it when creating tasks.</p></div><label>Project name<input required maxlength="120" value={projectName()} onInput={(event) => setProjectName(event.currentTarget.value)} placeholder="My application"/></label><label>Absolute folder path<input required value={projectDirectory()} onInput={(event) => setProjectDirectory(event.currentTarget.value)} placeholder="C:\\work\\my-app"/></label><button class="button button-primary" type="submit" disabled={saving()}>Add project</button></form></section>
      <section class="project-list"><div class="section-heading"><div><h2>Your projects</h2><p>{projects().length} registered or task-linked projects</p></div></div><Show when={projects().length === 0}><div class="workspace-empty compact"><h2>No projects yet</h2><p>Add a local folder, or create a task and its project will be registered automatically.</p></div></Show><For each={projects()}>{(project) => <article class="project-row"><div class="project-icon">⌘</div><div class="project-row-copy"><strong>{project.name}</strong><span>{project.directory}</span></div><span class="project-task-count">{tasks().filter((task) => normalizeProjectDirectory(task.projectDirectory) === normalizeProjectDirectory(project.directory)).length} tasks</span><button class="text-button" onClick={() => { setProjectFilter(project.directory); props.onNavigate("/board") }}>View tasks →</button></article>}</For></section>
    </Show>

    <Show when={!loading() && props.route === "/activity"}>
      <section class="activity-list"><Show when={activities().length === 0}><div class="workspace-empty compact"><h2>No activity yet</h2><p>Task and project changes will be recorded here.</p></div></Show><For each={activities()}>{(activity) => <article class="activity-row"><span class="activity-mark"/><div><strong>{activity.summary}</strong><p>{activity.type.replaceAll(".", " · ")}</p></div><time>{formatDate(activity.occurredAt)}</time></article>}</For></section>
    </Show>
    <Show when={!loading() && props.route === "/inbox"}>
      <div class="inbox-toolbar"><span>{inboxItems().length} {inboxItems().length === 1 ? "item" : "items"} need attention</span><button class="button button-quiet" onClick={() => void loadInbox()}>Refresh inbox</button></div>
      <Show when={inboxItems().length === 0}><section class="workspace-empty"><div class="empty-symbol">✓</div><h2>Nothing needs your attention</h2><p>Pending permissions, questions, and execution issues from linked OpenCode sessions will appear here.</p><Show when={runtimeStatus().status !== "connected"}><button class="text-button" onClick={() => props.onNavigate("/settings")}>Connect OpenCode →</button></Show></section></Show>
      <section class="inbox-list"><For each={inboxItems()}>{(item) => <article class="inbox-item">
        <div class="inbox-item-head"><span class={`inbox-kind inbox-${item.kind}`}>{item.kind.replaceAll("-", " ")}</span><span class="inbox-project">{item.task.projectDirectory}</span></div>
        <h2>{item.title}</h2><p class="inbox-task-title">{item.task.title}</p>
        {item.kind === "permission" ? <div class="inbox-detail"><p>{typeof item.permission.metadata?.message === "string" ? item.permission.metadata.message : "OpenCode is requesting permission to perform an action."}</p><Show when={Array.isArray(item.permission.metadata?.resources)}><ul><For each={item.permission.metadata?.resources as string[]}>{(resource) => <li><code>{resource}</code></li>}</For></ul></Show><div class="inbox-actions"><button class="button button-primary" disabled={runtimeBusy()} onClick={() => void respondPermission(item.permission.id, "once")}>Allow once</button><button class="button button-quiet" disabled={runtimeBusy()} onClick={() => void respondPermission(item.permission.id, "always")}>Always allow</button><button class="button button-danger" disabled={runtimeBusy()} onClick={() => void respondPermission(item.permission.id, "reject")}>Reject</button></div></div> : null}
        {item.kind === "question" ? <form class="inbox-question-form" onSubmit={(event) => void respondQuestion(event, item)}><For each={item.question.questions}>{(question) => <label>{question.question}{question.options?.length ? <select data-answer required><option value="">Choose an answer</option><For each={question.options}>{(option) => <option value={option}>{option}</option>}</For></select> : <input data-answer required maxlength="2000" placeholder="Your answer"/>}</label>}</For><button class="button button-primary" type="submit" disabled={runtimeBusy()}>Send answers to OpenCode</button></form> : null}
        {"reason" in item ? <div class="inbox-detail"><p>{item.reason}</p><button class="button button-quiet" onClick={() => openAttentionTask(item)}>Open task context</button><Show when={item.kind === "runtime-unavailable"}><button class="text-button" onClick={() => props.onNavigate("/settings")}>Connection settings →</button></Show></div> : null}
      </article>}</For></section>
    </Show>
    <Show when={!loading() && props.route === "/settings"}>
      <section class="health-panel"><div class="section-heading"><div><p class="eyebrow">SYSTEM STATUS</p><h2>Application health</h2><p>Foreman service, local persistence and OpenCode are monitored independently.</p></div><button class="button button-quiet" onClick={() => void refreshOperationalStatus()}>Refresh status</button></div><div class="health-grid"><article class="health-card"><span class={`health-indicator ${healthInfo()?.server?.status === "ready" ? "health-good" : "health-bad"}`}/><div><strong>Foreman server</strong><span>{healthInfo()?.server?.status === "ready" ? "Running" : "Unavailable"}</span><small>{healthInfo()?.server ? `Node ${healthInfo()!.server!.nodeVersion} · uptime ${healthInfo()!.server!.uptimeSeconds}s` : "Status unavailable"}</small></div></article><article class="health-card"><span class={`health-indicator ${healthInfo()?.database?.status === "ready" ? "health-good" : "health-bad"}`}/><div><strong>SQLite database</strong><span>{healthInfo()?.database?.status === "ready" ? "Healthy" : "Degraded"}</span><small>{healthInfo()?.database ? `Schema v${healthInfo()!.database!.schemaVersion}` : "Status unavailable"}{healthInfo()?.database?.message ? ` · ${healthInfo()!.database!.message}` : ""}</small></div></article><article class="health-card"><span class={`health-indicator ${runtimeStatus().status === "connected" ? "health-good" : runtimeStatus().status === "stale" ? "health-warn" : "health-muted"}`}/><div><strong>OpenCode runtime</strong><span>{runtimeStatus().status === "connected" ? `Connected · ${runtimeStatus().version ?? "2.4.x"}` : runtimeStatus().status === "stale" ? "Connection stale" : runtimeStatus().status}</span><small>{runtimeStatus().mode ? `${runtimeStatus().mode} mode` : "Independent of Foreman app health"}{runtimeStatus().reason ? ` · ${runtimeStatus().reason}` : ""}</small></div></article></div></section>
      <section class="backup-panel"><div class="section-heading"><div><p class="eyebrow">DATA SAFETY</p><h2>Backup & restore</h2><p>Export Foreman tasks, projects and activity. Works while OpenCode is offline.</p></div><button class="button button-primary" disabled={backupBusy() || healthInfo()?.database?.status !== "ready"} onClick={() => void downloadBackup()}>{backupBusy() ? "Preparing…" : "Download backup"}</button></div><div class="backup-policy"><span>Included: tasks, projects, activity and schema</span><span>Excluded: OpenCode credentials, connection settings and transcripts</span></div><label class="backup-upload">Restore from backup<input type="file" accept=".fbackup,application/vnd.foreman.backup" disabled={backupBusy()} onChange={previewBackupRestore}/><small>Select a .fbackup file to validate it and preview its contents. Current data is not changed during preview.</small></label><Show when={restorePreview()}><div class="restore-preview"><div><strong>Backup verified</strong><span>Created {new Date(restorePreview()!.manifest.createdAt).toLocaleString()} · schema v{restorePreview()!.manifest.schemaVersion}</span></div><div class="restore-counts"><span>{restorePreview()!.counts.tasks} tasks</span><span>{restorePreview()!.counts.projects} projects</span><span>{restorePreview()!.counts.activities} activity records</span></div><p>Restore replaces current Foreman data. Disconnect OpenCode and ensure no task is running before confirming. A rollback copy of the current database will be retained.</p><div class="detail-actions"><button class="button button-danger" disabled={backupBusy() || runtimeStatus().status === "connected" || runtimeStatus().status === "stale"} onClick={() => void confirmBackupRestore()}>Confirm restore</button><button class="button button-quiet" disabled={backupBusy()} onClick={() => setRestorePreview(undefined)}>Cancel</button></div></div></Show><Show when={backupNotice()}><p class="backup-success" role="status">{backupNotice()}</p></Show></section>
      <section class="runtime-settings-panel">
        <div class="section-heading"><div><p class="eyebrow">OPENCODE RUNTIME</p><h2>{runtimeStatus().status === "connected" ? "Runtime connected" : "Connect a runtime"}</h2><p>{runtimeStatus().status === "connected" ? `OpenCode ${runtimeStatus().version ?? "2.4.x"} · ${runtimeStatus().mode ?? "runtime"} mode` : "Foreman requires an OpenCode 2.4.x server. Your global CLI is not modified."}</p></div><div class="runtime-header-actions"><Show when={runtimeStatus().status === "connected"}><button class="button button-quiet" disabled={runtimeBusy()} onClick={() => void disconnectRuntime()}>Disconnect</button></Show><Show when={runtimeStatus().status !== "connected" && savedRuntimeSettings()}><button class="button button-primary" disabled={runtimeBusy() || savedRuntimeSettings()!.credentialRequired} onClick={() => void reconnectRuntime()}>{runtimeBusy() ? "Reconnecting…" : "Reconnect saved runtime"}</button></Show></div></div>
        <Show when={savedRuntimeSettings()}><div class="saved-runtime-note"><strong>Saved connection</strong><span>{savedRuntimeSettings()!.mode === "managed" ? `Managed · ${savedRuntimeSettings()!.executable || "opencode on PATH"}` : `External · ${savedRuntimeSettings()!.endpoint}`}</span><small>{savedRuntimeSettings()!.autoConnect ? "Automatically reconnects when Foreman starts." : "Auto-connect is off. Use Reconnect to start this saved configuration."}{savedRuntimeSettings()!.credentialRequired ? " Password is not persisted; enter it again to reconnect." : ""}</small></div></Show>
        <Show when={runtimeStatus().status !== "connected"}>
          <form class="runtime-connect-form" onSubmit={connectRuntime}>
            <label>Connection mode<select value={runtimeMode()} onChange={(event) => setRuntimeMode(event.currentTarget.value as "managed" | "external")}><option value="managed">Managed · Foreman starts OpenCode</option><option value="external">External · connect to an existing server</option></select></label>
            <Show when={runtimeMode() === "managed"}><label>OpenCode executable path (optional)<input value={runtimeExecutable()} onInput={(event) => setRuntimeExecutable(event.currentTarget.value)} placeholder="opencode or absolute path to 2.4.x binary"/><span class="form-note">Foreman checks the CLI version and can use the bundled OpenCode Desktop 2.4.x CLI when the PATH version is incompatible. Managed servers receive a private temporary password automatically. Foreman only stops the process it starts.</span></label></Show>
            <Show when={runtimeMode() === "external"}><label>Server endpoint<input required type="url" value={runtimeEndpoint()} onInput={(event) => setRuntimeEndpoint(event.currentTarget.value)} placeholder="http://127.0.0.1:4096"/></label><label>Username<input value={runtimeUsername()} onInput={(event) => setRuntimeUsername(event.currentTarget.value)}/></label><label>Password<input type="password" autocomplete="off" value={runtimePassword()} onInput={(event) => setRuntimePassword(event.currentTarget.value)} placeholder="Optional · never stored in SQLite"/><span class="form-note">Credentials are stored only in the OS vault when supported. Otherwise, Foreman asks for the password again after restart.</span></label></Show>
            <button class="button button-primary" type="submit" disabled={runtimeBusy()}>{runtimeBusy() ? "Connecting…" : "Connect OpenCode"}</button>
          </form>
        </Show>
        <Show when={runtimeStatus().status === "connected"}><div class="runtime-connected-note"><span class="status-dot status-online"/> Ready to execute tasks. Foreman will not start a session until you explicitly select Start on a Ready task.</div></Show>
        <Show when={runtimeStatus().status === "stale" || (runtimeStatus().status === "disconnected" && !!runtimeStatus().reason)}><p class="form-note">{runtimeStatus().reason}</p></Show>
      </section>
    </Show>

    <Show when={selected() && !editing()}><div class="detail-backdrop" role="presentation" onClick={() => setSelected(undefined)}><aside class="task-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(event) => event.stopPropagation()}><div class="detail-head"><span class="eyebrow">TASK DETAILS</span><button class="icon-button" aria-label="Close task details" onClick={() => setSelected(undefined)}>×</button></div><div class="task-title-row"><div class="task-title-copy"><span class="task-project">{projectLabel(selected()!)}</span><h2 id="detail-title">{selected()!.title}</h2></div><details class="task-options"><summary aria-label="Task options" title="Task options">...</summary><div class="task-options-menu"><button type="button" onClick={openEdit}>Edit task</button><button type="button" class="task-option-danger" disabled={!!selected()!.sessionID || !!selected()!.startPending} onClick={() => void deleteSelected()}>Delete task</button><div class="task-options-divider"/><details class="task-options-section"><summary>Task information</summary><div class="task-metadata-content"><div class="detail-field"><span>Status</span><select aria-label="Task status" disabled={selected()!.column === "doing"} value={selected()!.column} onChange={(event) => void moveTask(selected()!, event.currentTarget.value as TaskColumn)}><option value="todo">Todo</option><option value="ready">Ready</option><option value="doing" disabled>Doing - runtime controlled</option><option value="done">Done</option></select></div><div class="detail-field"><span>Project directory</span><code>{selected()!.projectDirectory}</code></div><div class="detail-field"><span>Agent</span><strong>{selected()!.agent || "build"}</strong></div><div class="detail-field"><span>Model</span><strong>{selected()!.model ? selected()!.model!.providerID + " / " + selected()!.model!.id : "Not specified"}</strong></div><div class="detail-field"><span>OpenCode session</span><strong>{selected()!.sessionID || "Not started"}<Show when={selected()!.sessionID && runtimeStatus().sessionBaseUrl}><a class="session-open-link" href={runtimeStatus().sessionBaseUrl + "/" + encodeURIComponent(selected()!.sessionID!)} target="_blank" rel="noreferrer">Open in OpenCode</a></Show></strong></div><div class="detail-field"><span>Execution state</span><strong>{executionLabel(selected()!, runtimeStatus())}</strong></div><div class="detail-field"><span>Created</span><strong>{formatDate(selected()!.createdAt)}</strong></div></div></details><details class="task-options-section"><summary>Task activity <span class="task-activity-count">{activities().filter((item) => item.taskId === selected()!.id).length}</span></summary><div class="task-options-activity"><For each={activities().filter((item) => item.taskId === selected()!.id)}>{(item) => <p class="detail-activity">{item.summary} <time>{formatDate(item.occurredAt)}</time></p>}</For></div></details></div></details></div><p class="detail-description">{selected()!.description || "No description provided."}</p><Show when={selected()!.startPending}><p class="workspace-alert" role="status">Start outcome is unknown. Inspect OpenCode before retrying; Foreman has blocked duplicate session creation.</p><button class="button button-quiet" disabled={runtimeBusy()} onClick={() => void recoverStartClaim()}>I confirmed no session exists · clear start lock</button></Show><Show when={selected()!.lastError}><p class="workspace-alert" role="status">{selected()!.lastError}</p></Show><Show when={selected()!.sessionID && selected()!.initialPromptState === "pending"}><p class="form-note">The initial prompt delivery state is unknown. Inspect this session in OpenCode before taking another action.</p></Show><Show when={selected()!.sessionID}><section class="task-conversation" aria-label="OpenCode conversation"><div class="conversation-heading"><h3>Conversation</h3><span>OpenCode {runtimeStatus().version ?? "version unavailable"} · {taskMessages().length} messages</span><button class="text-button jump-latest-button" type="button" onClick={() => jumpToLatestMessage()}>↓ Latest message</button></div><Show when={liveProgress()}><div class={`live-progress ${liveProgressActive() ? "live-progress-active" : "live-progress-idle"}`} role="status" aria-live="polite"><Show when={liveProgressActive()}><span class="live-progress-dot"/></Show><Show when={!liveProgressActive()}><span class="live-progress-check">✓</span></Show><span>{liveProgress()}</span></div></Show><div class="conversation-scroll"><Show when={taskMessages().length === 0 && !liveMessage()}><p class="form-note">No conversation messages are available yet.</p></Show><For each={taskMessages()}>{(message) => <article class={`conversation-message conversation-${message.role}`}><header><span class="conversation-avatar">{message.role === "assistant" ? "O" : "Y"}</span><strong>{message.role === "assistant" ? "OpenCode" : "You"}</strong><Show when={message.role === "assistant"}><small class="conversation-model">{message.model ? `${message.model.providerID} / ${message.model.id}` : "Model metadata unavailable"}</small></Show><time>{formatDate(message.createdAt)}</time></header><MessageMarkdown source={message.text}/></article>}</For><Show when={liveMessage()}><article class="conversation-message conversation-assistant conversation-live"><header><span class="conversation-avatar">O</span><strong>OpenCode</strong><small class="conversation-model">Streaming response</small><span class="live-cursor"/></header><MessageMarkdown source={liveMessage()!.text}/></article></Show></div></section></Show><Show when={!selected()!.sessionID}><div class="detail-actions"><button class="button button-primary" disabled={runtimeStatus().status !== "connected" || selected()!.column !== "ready" || selected()!.startPending || runtimeBusy()} onClick={() => void startSelected()}>{runtimeBusy() ? "Starting…" : selected()!.startPending ? "Start outcome unknown" : "Start task"}</button><Show when={runtimeStatus().status !== "connected"}><button class="button button-quiet" onClick={() => props.onNavigate("/settings")}>Connect OpenCode</button></Show></div></Show><Show when={selected()!.sessionID && selected()!.initialPromptState === "failed"}><button class="button button-primary" disabled={runtimeStatus().status !== "connected" || runtimeBusy()} onClick={() => void resendPrompt()}>Resend initial prompt</button></Show><Show when={selected()!.sessionID}><form class="follow-up-form" onSubmit={sendFollowUp}><Show when={liveProgressActive()}><div class="follow-up-working" role="status" aria-live="polite"><span class="button-spinner"/><span>{liveProgress()}</span></div></Show><div class="follow-up-composer"><textarea aria-label="Follow up in this session" required rows="1" maxlength="20000" disabled={runtimeBusy() || runtimeStatus().status !== "connected"} value={followUpText()} onInput={(event) => setFollowUpText(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (followUpText().trim() && !runtimeBusy() && runtimeStatus().status === "connected") event.currentTarget.form?.requestSubmit() } }} placeholder="Message OpenCode... (Enter to send, Shift+Enter for newline)"/><span class="composer-hint">Enter to send | Shift+Enter for newline</span></div></form></Show></aside></div></Show>

    <Show when={showCreate() || editing()}><div class="detail-backdrop" role="presentation" onClick={() => { setShowCreate(false); setEditing(false) }}><section class="task-form-dialog" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onClick={(event) => event.stopPropagation()}><div class="detail-head"><div><span class="eyebrow">WORK ITEM</span><h2 id="task-form-title">{editing() ? "Edit task" : "Create task"}</h2></div><button class="icon-button" aria-label="Close task form" onClick={() => { setShowCreate(false); setEditing(false) }}>×</button></div><form onSubmit={saveTask}><label>Task title<input required maxlength="200" autofocus value={formTitle()} onInput={(event) => setFormTitle(event.currentTarget.value)} placeholder="What needs to be done?"/></label><label>Description<textarea rows="4" value={formDescription()} onInput={(event) => setFormDescription(event.currentTarget.value)} placeholder="Describe the intent and expected outcome…"/></label><label>Project folder<input required value={formProject()} onInput={(event) => setFormProject(event.currentTarget.value)} list="project-directories" placeholder="C:\\work\\project"/><datalist id="project-directories"><For each={projects()}>{(project) => <option value={project.directory}>{project.name}</option>}</For></datalist></label><label>Project name<input value={formProjectName()} onInput={(event) => setFormProjectName(event.currentTarget.value)} placeholder="Optional display name"/></label><label>Agent<input value={formAgent()} onInput={(event) => setFormAgent(event.currentTarget.value)} placeholder="build"/></label><div class="form-two-columns"><label>Model provider ID<input value={formProvider()} onInput={(event) => setFormProvider(event.currentTarget.value)} placeholder="Optional provider"/></label><label>Model ID<input value={formModel()} onInput={(event) => setFormModel(event.currentTarget.value)} placeholder="Optional model"/></label></div><p class="form-note">Tasks are saved locally. Moving a task to Ready does not start an OpenCode session.</p><div class="detail-actions"><button class="button button-primary" type="submit" disabled={saving()}>{saving() ? "Saving…" : editing() ? "Save changes" : "Create task"}</button><button class="button button-quiet" type="button" onClick={() => { setShowCreate(false); setEditing(false) }}>Cancel</button></div></form></section></div></Show>
  </>
}
