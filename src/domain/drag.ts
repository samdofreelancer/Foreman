import type { TaskColumn } from "./task"

export type DropResolution =
  | { kind: "start"; taskID: string }
  | { kind: "move"; taskID: string; to: TaskColumn }
  | { kind: "reject"; reason: "managed" | "same" | "outside" }

export function resolveDrop(
  drag: { taskID: string; from: TaskColumn },
  target: TaskColumn | undefined,
): DropResolution {
  if (!target) return { kind: "reject", reason: "outside" }
  if (target === "doing") return { kind: "reject", reason: "managed" }
  if (target === drag.from) return { kind: "reject", reason: "same" }
  if (target === "ready") return { kind: "start", taskID: drag.taskID }
  return { kind: "move", taskID: drag.taskID, to: target }
}
