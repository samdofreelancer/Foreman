export type RunState = "working" | "unread" | "reviewed" | "missing"

export type RunStateInput = {
  present: boolean
  busy?: number
  idle?: number
  viewed?: number
}

export function deriveRunState(input: RunStateInput): RunState {
  if (!input.present) return "missing"
  if (
    typeof input.busy === "number"
    && typeof input.idle === "number"
    && input.busy > input.idle
  ) {
    return "working"
  }
  if (
    typeof input.idle === "number"
    && typeof input.viewed === "number"
    && input.idle >= input.viewed
  ) {
    return "unread"
  }
  return "reviewed"
}
