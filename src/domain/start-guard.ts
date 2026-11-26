import type { Task } from "./task"

export type StartGuardResult = {
  valid: boolean
  reason?: "missing-directory" | "session-linked" | "wrong-column" | "already-starting"
}

export function canStart(task: Task, starting: ReadonlySet<string>): StartGuardResult {
  if (starting.has(task.id)) {
    return { valid: false, reason: "already-starting" }
  }
  if (task.sessionID) {
    return { valid: false, reason: "session-linked" }
  }
  if (task.column !== "ready") {
    return { valid: false, reason: "wrong-column" }
  }
  if (!isAbsoluteDirectory(task.projectDirectory)) {
    return { valid: false, reason: "missing-directory" }
  }
  return { valid: true }
}

function isAbsoluteDirectory(directory: string): boolean {
  const value = directory.trim()
  return value.startsWith("/")
    || value.startsWith("\\\\")
    || /^[A-Za-z]:[\\/]/.test(value)
}
