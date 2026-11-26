import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"

export type SessionSnapshot = {
  connected: boolean
  present: boolean
  busy?: number
  idle?: number
  viewed?: number
  updated?: number
  started?: number
}

export function readSessionSnapshot(
  ctx: SetupContext<typeof definition>,
  sessionID?: string,
): SessionSnapshot {
  const server = ctx.servers.get("sidecar")
  if (!server?.connected) {
    return { connected: false, present: false }
  }
  if (!sessionID) {
    return { connected: true, present: false }
  }

  const data = server.data as unknown as {
    session: {
      missing?: (id: string) => boolean
      get: (id: string) => {
        time?: {
          busy?: number
          idle?: number
          viewed?: number
          updated?: number
          created?: number
        }
      } | undefined
      status?: (id: string) => "idle" | "running"
    }
  }
  if (data.session.missing?.(sessionID)) {
    return { connected: true, present: false }
  }
  const info = data.session.get(sessionID)
  if (!info) {
    return { connected: true, present: false }
  }
  return {
    connected: true,
    present: true,
    busy: info.time?.busy,
    idle: info.time?.idle,
    viewed: info.time?.viewed,
    updated: info.time?.updated,
    started: info.time?.created,
  }
}
