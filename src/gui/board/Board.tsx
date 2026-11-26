import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task, TaskColumn } from "../../domain/task"
import { groupTasks } from "../../domain/columns"
import { applyTaskFilters } from "../../domain/filters"
import { Column } from "./Column"
import { openTaskDialog } from "./TaskDialog"

const columns: readonly TaskColumn[] = ["todo", "ready", "doing", "done"]

export function Board(props: { ctx: SetupContext<typeof definition> }) {
  const [projectDirectory, setProjectDirectory] = createSignal<string>()
  const [search, setSearch] = createSignal("")
  const [searchInput, setSearchInput] = createSignal("")
  const [warningVisible, setWarningVisible] = createSignal(false)
  const [knownProjectDirectories, setKnownProjectDirectories] = createSignal<string[]>([])
  const [knownProjectsLoaded, setKnownProjectsLoaded] = createSignal(false)

  createEffect(() => {
    const sidecar = props.ctx.servers.list()
      .map((id) => props.ctx.servers.get(id))
      .find((server) => server?.builtin)
    if (!sidecar) return
    void sidecar.client.project.list().then((list) => {
      setKnownProjectDirectories(list.map((project) => project.canonical))
      setKnownProjectsLoaded(true)
    })
  })

  createEffect(() => {
    const value = props.ctx.stores.tasks.value
    const corrupt = !Array.isArray(value) || value.some((task) =>
      typeof task.id !== "string"
      || typeof task.title !== "string"
      || typeof task.projectDirectory !== "string"
    )
    setWarningVisible(corrupt)
  })

  createEffect(() => {
    const value = searchInput()
    const timer = setTimeout(() => setSearch(value), 150)
    onCleanup(() => clearTimeout(timer))
  })

  const tasks = createMemo<Task[]>(() => props.ctx.stores.tasks.value ?? [])
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
            />
          )}
        </For>
      </div>
    </div>
  )
}
