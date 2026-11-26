import { For, Show, createMemo, createSignal } from "solid-js"
import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task, TaskColumn } from "../../domain/task"
import { TaskCard } from "./TaskCard"

const labels: Record<TaskColumn, string> = {
  todo: "Todo",
  ready: "Ready",
  doing: "Doing",
  done: "Done",
}

export function Column(props: {
  ctx: SetupContext<typeof definition>
  column: TaskColumn
  tasks: Task[]
  knownProjectDirectories: readonly string[]
  knownProjectsLoaded: boolean
  hovered?: boolean
  onDragOver?: (column: TaskColumn, event: DragEvent) => void
  onDragLeave?: (column: TaskColumn) => void
  onDrop?: (column: TaskColumn, event: DragEvent) => void
  onDragStart?: (task: Task, event: DragEvent) => void
  onDragEnd?: () => void
}) {
  const [limit, setLimit] = createSignal(50)
  const visibleTasks = createMemo(() => props.tasks.slice(0, limit()))

  return (
    <section
      class={`foreman-column${props.hovered ? " foreman-column-hovered" : ""}`}
      data-column={props.column}
      onDragOver={(event) => props.onDragOver?.(props.column, event)}
      onDragLeave={() => props.onDragLeave?.(props.column)}
      onDrop={(event) => props.onDrop?.(props.column, event)}
    >
      <header class="foreman-column-header">
        <strong>{labels[props.column]}</strong>
        <span class="foreman-count">{props.tasks.length}</span>
      </header>
      <div class="foreman-card-list">
        <Show
          when={props.tasks.length > 0}
          fallback={<div class="foreman-empty">No tasks</div>}
        >
          <For each={visibleTasks()}>
            {(task) => (
              <TaskCard
                ctx={props.ctx}
                task={task}
                knownProjectDirectories={props.knownProjectDirectories}
                knownProjectsLoaded={props.knownProjectsLoaded}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
              />
            )}
          </For>
        </Show>
        <Show when={props.tasks.length > limit()}>
          <button
            class="foreman-show-more"
            type="button"
            onClick={() => setLimit((value) => value + 50)}
          >
            Show more
          </button>
        </Show>
      </div>
    </section>
  )
}
