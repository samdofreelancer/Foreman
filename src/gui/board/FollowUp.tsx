import { createMemo, createSignal, Show } from "solid-js"
import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import type { Task } from "../../domain/task"
import { deriveRunState } from "../../domain/run-state"
import { readSessionSnapshot } from "../run/session-info"
import { buildFollowUpInput } from "../run/follow-up"

export function FollowUp(props: {
  ctx: SetupContext<typeof definition>
  task: Task
}) {
  const [text, setText] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [sending, setSending] = createSignal(false)

  const working = createMemo(() => {
    if (!props.task.sessionID) return false
    const snapshot = readSessionSnapshot(props.ctx, props.task.sessionID)
    return snapshot.connected && deriveRunState({
      present: snapshot.present,
      busy: snapshot.busy,
      idle: snapshot.idle,
      viewed: snapshot.viewed,
    }) === "working"
  })

  const submit = async () => {
    if (!props.task.sessionID) return
    const input = buildFollowUpInput(
      props.task.sessionID,
      text(),
      working(),
    )
    if (!input) return
    const server = props.ctx.servers.get("sidecar")
    if (!server?.connected) {
      setError("Sidecar disconnected")
      return
    }
    setSending(true)
    setError(undefined)
    try {
      await server.client.session.prompt(input)
      setText("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to send follow-up")
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      class="foreman-follow-up"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        value={text()}
        placeholder="Follow up"
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <button
        type="submit"
        disabled={!text().trim() || sending() || !props.task.sessionID}
      >
        Send
      </button>
      <Show when={error()}>
        {(message) => <small class="foreman-follow-up-error">{message()}</small>}
      </Show>
    </form>
  )
}
