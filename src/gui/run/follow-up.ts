export type FollowUpInput = {
  sessionID: string
  text: string
  delivery?: "queue"
}

export function buildFollowUpInput(
  sessionID: string,
  text: string,
  working: boolean,
): FollowUpInput | undefined {
  const trimmed = text.trim()
  if (!sessionID || !trimmed) return undefined
  return working
    ? { sessionID, text: trimmed, delivery: "queue" }
    : { sessionID, text: trimmed }
}
