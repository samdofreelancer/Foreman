import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task } from "../../domain/task"
import { isProjectMissing } from "../../domain/filters"
import { deriveRunState } from "../../domain/run-state"
import { readSessionSnapshot } from "../run/session-info"
import { openTaskDialog } from "./TaskDialog"
import { FollowUp } from "./FollowUp"
import { createMemo, createSignal, onCleanup } from "solid-js"

export function TaskCard(props: {
  ctx: SetupContext<typeof definition>
  task: Task
  knownProjectDirectories: readonly string[]
  knownProjectsLoaded: boolean
  onDragStart?: (task: Task, event: DragEvent) => void
  onDragEnd?: () => void
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

  const retryPrompt = async () => {
    if (!props.task.sessionID) return
    const server = props.ctx.servers.get("sidecar")
    if (!server?.connected) return
    try {
      await server.client.session.prompt({
        sessionID: props.task.sessionID,
        text: props.task.description?.trim() || props.task.title,
      })
      props.ctx.stores.tasks.update((draft) => {
        const index = draft.findIndex((item) => item.id === props.task.id)
        if (index >= 0) {
          draft[index] = {
            ...draft[index],
            lastError: undefined,
            updatedAt: Date.now(),
          }
        }
      })
    } catch (error) {
      props.ctx.toast.show({
        title: "Prompt retry failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      })
    }
  }
  return (
    <article
      class="foreman-card"
      title={[
        props.task.title,
        props.task.projectDirectory,
        props.task.agent ? `Agent: ${props.task.agent}` : "",
        props.task.model ? `Model: ${props.task.model.providerID}/${props.task.model.id}` : "",
      ].filter(Boolean).join(" — ")}
      role="button"
      tabIndex={0}
      draggable={true}
      onDragStart={(event) => props.onDragStart?.(props.task, event)}
      onDragEnd={() => props.onDragEnd?.()}
      onClick={() => {
        if (props.task.sessionID) openSession()
        else openTaskDialog(props.ctx, props.task)
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLElement
          && event.target.closest("input,textarea,button,select,a")
        ) return
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
        {props.task.sessionID ? (
          <FollowUp ctx={props.ctx} task={props.task} />
        ) : null}
        {props.task.lastError && props.task.sessionID ? (
          <button
            type="button"
            class="foreman-prompt-retry"
            onClick={(event) => {
              event.stopPropagation()
              void retryPrompt()
            }}
          >
            Send prompt again
          </button>
        ) : null}
        <span>{updated}</span>
        <span class="foreman-column-name">{props.task.column}</span>
      </div>
    </article>
  )
}
