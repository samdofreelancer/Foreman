import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task } from "../../domain/task"
import { openTaskDialog } from "./TaskDialog"

export function TaskCard(props: {
  ctx: SetupContext<typeof definition>
  task: Task
}) {
  const updated = new Date(props.task.updatedAt).toLocaleString()
  return (
    <article
      class="foreman-card"
      title={props.task.title}
      role="button"
      tabIndex={0}
      onClick={() => openTaskDialog(props.ctx, props.task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openTaskDialog(props.ctx, props.task)
        }
      }}
    >
      <h3>{props.task.title}</h3>
      <div class="foreman-card-meta">
        <span>{props.task.projectName ?? props.task.projectDirectory}</span>
        <span>{updated}</span>
        <span class="foreman-column-name">{props.task.column}</span>
      </div>
    </article>
  )
}
