import type { TaskColumn } from "../../domain/task"
import { resolveDrop as resolvePureDrop } from "../../domain/drag"

export type DragState = {
  taskID?: string
  from?: TaskColumn
  hovered?: TaskColumn
}

export function resolveBoardDrop(
  state: DragState,
  target: TaskColumn | undefined,
) {
  if (!state.taskID || !state.from) {
    return { kind: "reject", reason: "outside" } as const
  }
  return resolvePureDrop(
    { taskID: state.taskID, from: state.from },
    target,
  )
}
