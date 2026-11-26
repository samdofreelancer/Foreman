import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task } from "../../domain/task"
import { isProjectMissing } from "../../domain/filters"
import { deriveRunState } from "../../domain/run-state"
import { readSessionSnapshot } from "../run/session-info"
import { openTaskDialog } from "./TaskDialog"
import { createMemo, createSignal, onCleanup } from "solid-js"

export function TaskCard(props: {
  ctx: SetupContext<typeof definition>
  task: Task
  knownProjectDirectories: readonly string[]
  knownProjectsLoaded: boolean
}) {
  const [tick, setTick] = createSignal(Date.now())
  const timer = setInterval(() => setTick(Date.now()), 3000)
  onCleanup(() => clearInterval(timer))

  const snapshot = createMemo(() => readSessionSnapshot(props.ctx, props.task.sessionID))
  const runState = createMemo(() => {
    tick()
    const state = snapshot()
    if (!state.connected) return "disconnected"
    if (!props.task.sessionID) return "none"
    return deriveRunState({
      present: state.present,
      busy: state.busy,
      idle: state.idle,
      viewed: state.viewed,
    })
  })
  const updated = new Date(props.task.updatedAt).toLocaleString()
  const activity = createMemo(() => {
    const state = snapshot()
    if (runState() === "working") {
      const started = state.started ?? props.task.startedAt ?? props.task.updatedAt
      const elapsed = Math.max(0, Math.floor((tick() - started) / 1000))
      if (elapsed < 60) return `${elapsed}s elapsed`
      return `${Math.floor(elapsed / 60)}m elapsed`
    }
    const at = state.updated ?? props.task.updatedAt
    return `Activity ${new Date(at).toLocaleString()}`
  })

  const openSession = () => {
    if (!props.task.sessionID) return
    props.ctx.tabs.open(
      { server: "sidecar", id: props.task.sessionID },
      { focus: true },
    )
  }
  return (
    <article
      class="foreman-card"
      title={props.task.title}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (props.task.sessionID) openSession()
        else openTaskDialog(props.ctx, props.task)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          if (props.task.sessionID) openSession()
          else openTaskDialog(props.ctx, props.task)
        }
      }}
    >
      <h3>{props.task.title}</h3>
      <div class="foreman-card-meta">
        <span>{props.task.projectName ?? props.task.projectDirectory}</span>
        {props.knownProjectsLoaded &&
        isProjectMissing(props.task.projectDirectory, props.knownProjectDirectories) ? (
          <span class="foreman-project-missing">Project missing</span>
        ) : null}
        {props.task.sessionID ? (
          <>
            <span class={`foreman-run-state foreman-run-${runState()}`}>
              {runState()}
            </span>
            <span>{activity()}</span>
          </>
        ) : null}
        <span>{updated}</span>
        <span class="foreman-column-name">{props.task.column}</span>
      </div>
    </article>
  )
}
