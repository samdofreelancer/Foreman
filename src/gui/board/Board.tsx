import { For, createMemo, createSignal } from "solid-js"
import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task, TaskColumn } from "../../domain/task"
import { groupTasks } from "../../domain/columns"
import { applyTaskFilters } from "../../domain/filters"
import { Column } from "./Column"

const columns: readonly TaskColumn[] = ["todo", "ready", "doing", "done"]

export function Board(props: { ctx: SetupContext<typeof definition> }) {
  const [projectDirectory, setProjectDirectory] = createSignal<string>()
  const [search, setSearch] = createSignal("")

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
      <div class="foreman-toolbar">
        <button class="foreman-primary" type="button">New task</button>
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
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
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
            />
          )}
        </For>
      </div>
    </div>
  )
}
