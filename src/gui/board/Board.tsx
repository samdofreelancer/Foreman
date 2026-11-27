import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task, TaskColumn } from "../../domain/task"
import { groupTasks } from "../../domain/columns"
import { applyTaskFilters, reconcileProjectFilter } from "../../domain/filters"
import { safeTaskArray } from "../../domain/task"
import { Column } from "./Column"
import { openTaskDialog } from "./TaskDialog"
import { resolveBoardDrop } from "./drag"
import { startTask } from "../run/start-task"
import { setTaskFinished, clearTaskFinished } from "../../domain/task"
import { deriveRunState } from "../../domain/run-state"
import { readSessionSnapshot } from "../run/session-info"
import type { StartTaskContext } from "../run/start-task"

const columns: readonly TaskColumn[] = ["todo", "ready", "doing", "done"]

export function Board(props: { ctx: SetupContext<typeof definition> }) {
  const [projectDirectory, setProjectDirectory] = createSignal<string>()
  const [search, setSearch] = createSignal("")
  const [searchInput, setSearchInput] = createSignal("")
  const [warningVisible, setWarningVisible] = createSignal(false)
  const [knownProjectDirectories, setKnownProjectDirectories] = createSignal<string[]>([])
  const [knownProjectsLoaded, setKnownProjectsLoaded] = createSignal(false)
  const [dragTaskID, setDragTaskID] = createSignal<string>()
  const [dragFrom, setDragFrom] = createSignal<Task["column"]>()
  const [hoveredColumn, setHoveredColumn] = createSignal<Task["column"]>()

  createEffect(() => {
    const sidecar = props.ctx.servers.list()
      .map((id) => props.ctx.servers.get(id))
      .find((server) => server?.builtin)
    if (!sidecar) return
    void sidecar.client.project.list()
      .then((list) => {
        setKnownProjectDirectories(list.map((project) => project.canonical))
        setKnownProjectsLoaded(true)
      })
      .catch(() => setKnownProjectsLoaded(true))
  })

  createEffect(() => {
    const value = props.ctx.stores.tasks.value
    const corrupt = !Array.isArray(value)
      || value.some((task) => !task || typeof task.id !== "string")
    setWarningVisible(corrupt)
  })

  createEffect(() => {
    const value = searchInput()
    const timer = setTimeout(() => setSearch(value), 150)
    onCleanup(() => clearTimeout(timer))
  })

  const tasks = createMemo<Task[]>(() => safeTaskArray(props.ctx.stores.tasks.value))
  createEffect(() => {
    setProjectDirectory((selected) =>
      reconcileProjectFilter(selected, tasks()),
    )
  })
  const filtered = createMemo(() =>
    applyTaskFilters(tasks(), projectDirectory(), search()),
  )
  const groups = createMemo(() => groupTasks(filtered()))
  const projects = createMemo(() => {
    const values = new Map<string, string>()
    for (const task of tasks()) {
      values.set(task.projectDirectory, task.projectName ?? task.projectDirectory)
    }
    return [...values.entries()]
  })

  const clearDrag = () => {
    setDragTaskID(undefined)
    setDragFrom(undefined)
    setHoveredColumn(undefined)
  }

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag()
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  const handleDragStart = (task: Task, event: DragEvent) => {
    setDragTaskID(task.id)
    setDragFrom(task.column)
    event.dataTransfer?.setData("text/plain", task.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (column: Task["column"], event: DragEvent) => {
    event.preventDefault()
    setHoveredColumn(column)
  }

  const handleDrop = (column: Task["column"], event: DragEvent) => {
    event.preventDefault()
    const resolution = resolveBoardDrop(
      { taskID: dragTaskID(), from: dragFrom(), hovered: hoveredColumn() },
      column,
    )
    clearDrag()

    if (resolution.kind !== "move") {
      if (resolution.kind === "reject" && resolution.reason === "managed") {
        props.ctx.toast.show({ title: "Doing is managed by runs", variant: "error" })
      }
      return
    }

    const task = tasks().find((item) => item.id === resolution.taskID)
    if (!task) return

    void (async () => {
      if (resolution.to === "done" && task.sessionID) {
        const snapshot = readSessionSnapshot(props.ctx, task.sessionID)
        const state = deriveRunState({
          present: snapshot.present,
          busy: snapshot.busy,
          idle: snapshot.idle,
          viewed: snapshot.viewed,
        })
        if (!snapshot.connected || state === "working" || state === "missing") {
          const confirmed = await props.ctx.dialogs.confirm({
            title: "The run is still working",
            confirm: "Move to Done",
            danger: false,
          })
          if (!confirmed) return
        }
      }

      props.ctx.stores.tasks.update((draft) => {
        const index = draft.findIndex((item) => item.id === task.id)
        if (index < 0) return
        const now = Date.now()
        draft[index] = resolution.to === "done"
          ? setTaskFinished(draft[index], now)
          : resolution.to === "todo" || resolution.to === "ready"
            ? clearTaskFinished(draft[index], resolution.to, now)
            : { ...draft[index], column: resolution.to, updatedAt: now }
      })
    })()
  }

  return (
    <div class="foreman-board">
      <Show when={warningVisible()}>
        <div class="foreman-warning">
          Task data could not be loaded. The board is starting empty.
          <button type="button" onClick={() => setWarningVisible(false)}>Dismiss</button>
        </div>
      </Show>
      <div class="foreman-toolbar">
        <button
          class="foreman-primary"
          type="button"
          onClick={() => openTaskDialog(props.ctx)}
        >
          New task
        </button>
        <label>
          <span>Project</span>
          <select
            value={projectDirectory() ?? ""}
            onInput={(event) => setProjectDirectory(event.currentTarget.value || undefined)}
          >
            <option value="">All projects</option>
            <For each={projects()}>
              {([directory, name]) => <option value={directory}>{name}</option>}
            </For>
          </select>
        </label>
        <label>
          <span>Search</span>
          <input
            value={searchInput()}
            onInput={(event) => setSearchInput(event.currentTarget.value)}
            placeholder="Search tasks"
          />
        </label>
      </div>
      <div class="foreman-columns" role="region" aria-label="Task board">
        <For each={columns}>
          {(column) => (
            <Column
              ctx={props.ctx}
              column={column}
              tasks={groups()[column]}
              knownProjectDirectories={knownProjectDirectories()}
              knownProjectsLoaded={knownProjectsLoaded()}
              hovered={hoveredColumn() === column}
              onDragOver={handleDragOver}
              onDragLeave={() => setHoveredColumn(undefined)}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragEnd={clearDrag}
            />
          )}
        </For>
      </div>
    </div>
  )
}
