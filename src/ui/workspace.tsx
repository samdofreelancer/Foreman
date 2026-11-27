import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { applyTaskFilters, normalizeProjectDirectory } from "../domain/filters"
import { groupTasks } from "../domain/columns"
import type { Task, TaskColumn } from "../domain/task"
import type { Project } from "../domain/project"
import type { ActivityEvent } from "../domain/activity"
import type { AppRoute } from "./routes"

type RuntimeView = { status: "connected" | "stale" | "connecting" | "disconnected"; mode?: "managed" | "external"; version?: string; reason?: string; sessionBaseUrl?: string }
type Props = { route: AppRoute; csrfToken: string; onNavigate(path: AppRoute): void; onRuntimeChange(status: RuntimeView): void }
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
  const [followUpText, setFollowUpText] = createSignal("")

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    setSelected(undefined)
    setEditing(false)
    setShowCreate(false)
  }
  window.addEventListener("keydown", handleEscape)
  onCleanup(() => window.removeEventListener("keydown", handleEscape))

  const refresh = async () => {
    setLoading(true)
    setError("")
    try {
      const [taskResult, projectResult, activityResult, runtimeResult] = await Promise.all([
        request<{ tasks: Task[] }>("/api/tasks", props.csrfToken),
        request<{ projects: Project[] }>("/api/projects", props.csrfToken),
        request<{ activities: ActivityEvent[] }>("/api/activity", props.csrfToken),
        request<{ runtime: RuntimeView }>("/api/runtime", props.csrfToken),
      ])
      setTasks(taskResult.tasks)
      setProjects(projectResult.projects)
      setActivities(activityResult.activities)
      setRuntimeStatus(runtimeResult.runtime)
      props.onRuntimeChange(runtimeResult.runtime)
      if (projectFilter() && !projectResult.projects.some((project) => normalizeProjectDirectory(project.directory) === normalizeProjectDirectory(projectFilter()))) setProjectFilter("")
      if (selected()) setSelected(taskResult.tasks.find((task) => task.id === selected()!.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workspace data.")
    } finally { setLoading(false) }
  }
  void refresh()

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
    setRuntimeBusy(true); setError("")
    try {
      await request(`/api/tasks/${task.id}/follow-up`, props.csrfToken, "POST", { text: followUpText() })
      setFollowUpText(""); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Follow-up could not be sent.") }
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
      <section class="project-create-panel"><form onSubmit={saveProject}><div><h2>Add a local project</h2><p>Register a project folder to use it when creating tasks.</p></div><label>Project name<input required maxlength="120" value={projectName()} onInput={(event) => setProjectName(event.currentTarget.value)} placeholder="My application"/></label><label>Absolute folder path<input required value={projectDirectory()} onInput={(event) => setProjectDirectory(event.currentTarget.value)} placeholder="C:\\work\\my-app"/></label><button class="button button-primary" type="submit" disabled={saving()}>Add project</button></form></section>
      <section class="project-list"><div class="section-heading"><div><h2>Your projects</h2><p>{projects().length} registered or task-linked projects</p></div></div><Show when={projects().length === 0}><div class="workspace-empty compact"><h2>No projects yet</h2><p>Add a local folder, or create a task and its project will be registered automatically.</p></div></Show><For each={projects()}>{(project) => <article class="project-row"><div class="project-icon">⌘</div><div class="project-row-copy"><strong>{project.name}</strong><span>{project.directory}</span></div><span class="project-task-count">{tasks().filter((task) => normalizeProjectDirectory(task.projectDirectory) === normalizeProjectDirectory(project.directory)).length} tasks</span><button class="text-button" onClick={() => { setProjectFilter(project.directory); props.onNavigate("/board") }}>View tasks →</button></article>}</For></section>
    </Show>

    <Show when={!loading() && props.route === "/activity"}>
      <section class="activity-list"><Show when={activities().length === 0}><div class="workspace-empty compact"><h2>No activity yet</h2><p>Task and project changes will be recorded here.</p></div></Show><For each={activities()}>{(activity) => <article class="activity-row"><span class="activity-mark"/><div><strong>{activity.summary}</strong><p>{activity.type.replaceAll(".", " · ")}</p></div><time>{formatDate(activity.occurredAt)}</time></article>}</For></section>
    </Show>
    <Show when={!loading() && props.route === "/inbox"}><section class="workspace-empty"><div class="empty-symbol">✓</div><h2>Nothing needs your attention</h2><p>OpenCode is disconnected. When runtime attention is supported and connected, permissions and questions will appear here.</p><button class="text-button" onClick={() => props.onNavigate("/settings")}>Connection settings →</button></section></Show>
    <Show when={!loading() && props.route === "/settings"}>
      <section class="runtime-settings-panel">
        <div class="section-heading"><div><p class="eyebrow">OPENCODE RUNTIME</p><h2>{runtimeStatus().status === "connected" ? "Runtime connected" : "Connect a runtime"}</h2><p>{runtimeStatus().status === "connected" ? `OpenCode ${runtimeStatus().version ?? "2.4.x"} · ${runtimeStatus().mode ?? "runtime"} mode` : "Foreman requires an OpenCode 2.4.x server. Your global CLI is not modified."}</p></div><Show when={runtimeStatus().status === "connected"}><button class="button button-quiet" disabled={runtimeBusy()} onClick={() => void disconnectRuntime()}>Disconnect</button></Show></div>
        <Show when={runtimeStatus().status !== "connected"}>
          <form class="runtime-connect-form" onSubmit={connectRuntime}>
            <label>Connection mode<select value={runtimeMode()} onChange={(event) => setRuntimeMode(event.currentTarget.value as "managed" | "external")}><option value="managed">Managed · Foreman starts OpenCode</option><option value="external">External · connect to an existing server</option></select></label>
            <Show when={runtimeMode() === "managed"}><label>OpenCode executable path (optional)<input value={runtimeExecutable()} onInput={(event) => setRuntimeExecutable(event.currentTarget.value)} placeholder="opencode or absolute path to 2.4.x binary"/><span class="form-note">The default executable on PATH must report version 2.4.x. Foreman will only stop the process it starts.</span></label></Show>
            <Show when={runtimeMode() === "external"}><label>Server endpoint<input required type="url" value={runtimeEndpoint()} onInput={(event) => setRuntimeEndpoint(event.currentTarget.value)} placeholder="http://127.0.0.1:4096"/></label><label>Username<input value={runtimeUsername()} onInput={(event) => setRuntimeUsername(event.currentTarget.value)}/></label><label>Password<input type="password" autocomplete="off" value={runtimePassword()} onInput={(event) => setRuntimePassword(event.currentTarget.value)} placeholder="Optional · held in memory only"/></label></Show>
            <button class="button button-primary" type="submit" disabled={runtimeBusy()}>{runtimeBusy() ? "Connecting…" : "Connect OpenCode"}</button>
          </form>
        </Show>
        <Show when={runtimeStatus().status === "connected"}><div class="runtime-connected-note"><span class="status-dot status-online"/> Ready to execute tasks. Foreman will not start a session until you explicitly select Start on a Ready task.</div></Show>
        <Show when={runtimeStatus().status === "stale" || (runtimeStatus().status === "disconnected" && !!runtimeStatus().reason)}><p class="form-note">{runtimeStatus().reason}</p></Show>
      </section>
    </Show>

    <Show when={selected() && !editing()}><div class="detail-backdrop" role="presentation" onClick={() => setSelected(undefined)}><aside class="task-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(event) => event.stopPropagation()}><div class="detail-head"><span class="eyebrow">TASK DETAILS</span><button class="icon-button" aria-label="Close task details" onClick={() => setSelected(undefined)}>×</button></div><span class="task-project">{projectLabel(selected()!)}</span><h2 id="detail-title">{selected()!.title}</h2><p class="detail-description">{selected()!.description || "No description provided."}</p><div class="detail-field"><span>Status</span><select aria-label="Task status" disabled={selected()!.column === "doing"} value={selected()!.column} onChange={(event) => void moveTask(selected()!, event.currentTarget.value as TaskColumn)}><option value="todo">Todo</option><option value="ready">Ready</option><option value="doing" disabled>Doing · runtime controlled</option><option value="done">Done</option></select></div><div class="detail-field"><span>Project directory</span><code>{selected()!.projectDirectory}</code></div><div class="detail-field"><span>Agent</span><strong>{selected()!.agent || "build"}</strong></div><div class="detail-field"><span>Model</span><strong>{selected()!.model ? `${selected()!.model!.providerID} / ${selected()!.model!.id}` : "Not specified"}</strong></div><div class="detail-field"><span>OpenCode session</span><strong>{selected()!.sessionID || "Not started"}<Show when={selected()!.sessionID && runtimeStatus().sessionBaseUrl}><a class="session-open-link" href={`${runtimeStatus().sessionBaseUrl}/${encodeURIComponent(selected()!.sessionID!)}`} target="_blank" rel="noreferrer">Open in OpenCode ↗</a></Show></strong></div><div class="detail-field"><span>Execution state</span><strong>{executionLabel(selected()!, runtimeStatus())}</strong></div><Show when={selected()!.startPending}><p class="workspace-alert" role="status">Start outcome is unknown. Inspect OpenCode before retrying; Foreman has blocked duplicate session creation.</p><button class="button button-quiet" disabled={runtimeBusy()} onClick={() => void recoverStartClaim()}>I confirmed no session exists · clear start lock</button></Show><Show when={selected()!.lastError}><p class="workspace-alert" role="status">{selected()!.lastError}</p></Show><Show when={selected()!.sessionID && selected()!.initialPromptState === "pending"}><p class="form-note">The initial prompt delivery state is unknown. Inspect this session in OpenCode before taking another action.</p></Show><Show when={!selected()!.sessionID}><div class="detail-actions"><button class="button button-primary" disabled={runtimeStatus().status !== "connected" || selected()!.column !== "ready" || selected()!.startPending || runtimeBusy()} onClick={() => void startSelected()}>{runtimeBusy() ? "Starting…" : selected()!.startPending ? "Start outcome unknown" : "Start task"}</button><Show when={runtimeStatus().status !== "connected"}><button class="button button-quiet" onClick={() => props.onNavigate("/settings")}>Connect OpenCode</button></Show></div></Show><Show when={selected()!.sessionID && selected()!.initialPromptState === "failed"}><button class="button button-primary" disabled={runtimeStatus().status !== "connected" || runtimeBusy()} onClick={() => void resendPrompt()}>Resend initial prompt</button></Show><Show when={selected()!.sessionID}><form class="follow-up-form" onSubmit={sendFollowUp}><label>Follow up in this session<textarea required rows="3" maxlength="20000" value={followUpText()} onInput={(event) => setFollowUpText(event.currentTarget.value)} placeholder="Give OpenCode the next instruction…"/></label><button class="button button-primary" type="submit" disabled={runtimeStatus().status !== "connected" || runtimeBusy() || !followUpText().trim()}>Send follow-up</button></form></Show><div class="detail-field"><span>Created</span><strong>{formatDate(selected()!.createdAt)}</strong></div><div class="detail-actions"><button class="button button-quiet" onClick={openEdit}>Edit task</button><button class="button button-danger" disabled={!!selected()!.sessionID || !!selected()!.startPending} onClick={() => void deleteSelected()}>Delete</button></div><h3 class="detail-activity-title">Task activity</h3><For each={activities().filter((item) => item.taskId === selected()!.id)}>{(item) => <p class="detail-activity">{item.summary} <time>{formatDate(item.occurredAt)}</time></p>}</For></aside></div></Show>

    <Show when={showCreate() || editing()}><div class="detail-backdrop" role="presentation" onClick={() => { setShowCreate(false); setEditing(false) }}><section class="task-form-dialog" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onClick={(event) => event.stopPropagation()}><div class="detail-head"><div><span class="eyebrow">WORK ITEM</span><h2 id="task-form-title">{editing() ? "Edit task" : "Create task"}</h2></div><button class="icon-button" aria-label="Close task form" onClick={() => { setShowCreate(false); setEditing(false) }}>×</button></div><form onSubmit={saveTask}><label>Task title<input required maxlength="200" autofocus value={formTitle()} onInput={(event) => setFormTitle(event.currentTarget.value)} placeholder="What needs to be done?"/></label><label>Description<textarea rows="4" value={formDescription()} onInput={(event) => setFormDescription(event.currentTarget.value)} placeholder="Describe the intent and expected outcome…"/></label><label>Project folder<input required value={formProject()} onInput={(event) => setFormProject(event.currentTarget.value)} list="project-directories" placeholder="C:\\work\\project"/><datalist id="project-directories"><For each={projects()}>{(project) => <option value={project.directory}>{project.name}</option>}</For></datalist></label><label>Project name<input value={formProjectName()} onInput={(event) => setFormProjectName(event.currentTarget.value)} placeholder="Optional display name"/></label><label>Agent<input value={formAgent()} onInput={(event) => setFormAgent(event.currentTarget.value)} placeholder="build"/></label><div class="form-two-columns"><label>Model provider ID<input value={formProvider()} onInput={(event) => setFormProvider(event.currentTarget.value)} placeholder="Optional provider"/></label><label>Model ID<input value={formModel()} onInput={(event) => setFormModel(event.currentTarget.value)} placeholder="Optional model"/></label></div><p class="form-note">Tasks are saved locally. Moving a task to Ready does not start an OpenCode session.</p><div class="detail-actions"><button class="button button-primary" type="submit" disabled={saving()}>{saving() ? "Saving…" : editing() ? "Save changes" : "Create task"}</button><button class="button button-quiet" type="button" onClick={() => { setShowCreate(false); setEditing(false) }}>Cancel</button></div></form></section></div></Show>
  </>
}
