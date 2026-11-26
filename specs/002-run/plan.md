# Implementation Plan: Run the Task (P2)

**Branch**: `002-run` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-run/spec.md`

## Summary

Turn Ready into work. Dropping a task on Ready (or, from P1's dialog, setting it to Ready)
creates one OpenCode session in the task's directory through the app's own client, sends
the description as the first prompt, stores the session id, and moves the card to Doing.
Doing then derives its badge from live session data, opening a card focuses the session
tab, follow-ups go to the same session, and Done closes the loop. P2 also adds
drag-and-drop, which P1 omits, and still never approves a permission or answers a
question.

## Technical Context

**Language/Version**: TypeScript 5.x, SolidJS 1.9 (continues P1)

**Primary Dependencies**: host-provided `@opencode/plugin/gui` and `@opencode/client`;
no new package dependencies

**Storage**: P1 plugin store plus `sessionID`, `startedAt`, `finishedAt` on the task

**Testing**: Vitest for `src/domain/run-state.ts` and the start guard; manual desktop
acceptance for session creation, tab focus, and live state

**Target Platform**: OpenCode Desktop 2.x

**Performance Goals**: card state change visible within 5 s; no polling faster than 3 s;
board stays at 60 fps while a run streams

**Constraints**: never write the OpenCode database; never auto-approve; one session per
task; the app's server id is `sidecar`

**Scale/Scope**: dozens of tasks, a handful of concurrent runs

## Constitution Check

Gates from [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md):

1. **Article II — never touch the database** — pass: all run data comes from the OpenCode
   client and its synced server store.
2. **Article I — owner decides** — pass: permissions and questions stay untouched in P2;
   every run starts from a drop or a dialog save.
3. **Article III — one task, one session** — enforced by the start guard and the stored id.
4. **Article V — degrade** — pass: an unavailable server renders a disconnected state.
5. **Article VIII — isolate the API** — pass: all client calls live in `gui/run/`.

## Project Structure

```text
src/
├── domain/
│   ├── run-state.ts            # pure RunState derivation + precedence
│   ├── start-guard.ts          # pure "may this task start?" decision
│   └── drag.ts                 # pure drop resolution (origin, target, allowed)
├── gui/
│   ├── run/
│   │   ├── session-info.ts     # reactive read for a task's session
│   │   └── start-task.ts       # create session + first prompt, transactional
│   └── board/
│       ├── TaskCard.tsx        # gains run badge, click-to-open, elapsed time
│       ├── FollowUp.tsx        # follow-up composer on a Doing card
│       ├── drag.ts             # DOM drag state and handlers
│       └── Board.tsx           # Ready drop starts; Done confirms while running
tests/
├── run-state.test.ts
├── start-guard.test.ts
└── drag.test.ts
```

**Structure Decision**: the run machinery is split into a pure decision layer
(`domain/`) and a thin host-calling layer (`gui/run/`), so the state machine is testable
without Electron or a live server.

## Design

### Start transaction

```text
drop on Ready
  → guard: no sessionID, not starting, column is ready, directory exists
  → mark starting (module-level Set keyed by task id)
  → client.session.create({ title, agent, model, location: { directory } })
  → store.update: sessionID = created.id, column = "doing", startedAt = now
  → client.session.prompt({ sessionID, text: description || title })
  → on prompt failure: keep sessionID, column doing, show "Send prompt again",
    never create a second session
  → finally: release starting
```

The guard runs twice: on drop, and again immediately before `create` after the `await` of
any preceding work, so a double drop cannot race.

### Reactive state

```ts
const server = ctx.servers.get("sidecar")
const info = () => (task.sessionID ? server?.data.session.get(task.sessionID) : undefined)
```

`data.session.get(id)` is the app's reactive store, so `busy`, `idle`, `viewed`, and
`title` update without polling. A 3-second timer covers gaps (server reconnect, missed
events) and is cleared with the component.

Derivation (pure, precedence order):

```ts
action_required  // P3
error            // P3
working          // busy > idle
unread           // idle >= viewed
reviewed         // otherwise
missing          // no info for a set sessionID
```

### Opening and follow-up

- Click card: `ctx.tabs.open({ server: "sidecar", id: task.sessionID }, { focus: true })`.
  The host marks the session viewed, which flips the badge to `reviewed`.
- Follow-up: `client.session.prompt({ sessionID, text, delivery: "queue" })` when the
  session is working, otherwise no delivery hint. Empty text is rejected in the UI.

### Done semantics

Dropping on Done sets `finishedAt`. If the session is working, `ctx.dialogs.confirm`
explains that the run continues. Moving back to Todo/Ready clears `finishedAt` and keeps
`sessionID`.

### Drag and drop

P1 ships without drag, so P2 owns the whole interaction:

```ts
// domain/drag.ts — pure, tested
resolveDrop(drag: { taskID: string; from: Column }, target: Column) =>
  | { kind: "move"; taskID: string; to: Column }
  | { kind: "start"; taskID: string }
  | { kind: "reject"; reason: "managed" | "same" | "outside" }
```

- `target === "ready"` → `start`, routed through `startTask` (never a bare column write).
- `target === "doing"` → `reject` with "Doing is managed by runs".
- `target === from` or a drop outside a column → `reject`, no write.
- Otherwise → `move`, writing `column` and `updatedAt` (plus `finishedAt` rules for Done).

DOM handling lives in `gui/board/drag.ts`: `draggable` on the card, `dragstart` sets the
payload, columns handle `dragover`/`dragleave` with a highlight class, `drop` calls
`resolveDrop`, `Escape` and `dragend` clear the state. The dialog select from P1 stays as
the keyboard and screen-reader path, so drag is an accelerator, never a requirement.

## Research notes (verified against OpenCode 2.x)

- `client.session.create({ title, agent, model, location: { directory } })` accepts
  `Location.PublicRef = { directory }` and returns `{ data: Session.Info }`.
- `client.session.prompt({ sessionID, text, delivery })` accepts `delivery: "steer" |
  "queue"`.
- `Session.Info.time` carries `created`, `updated`, `busy`, `idle`, `viewed`.
- `ctx.tabs.open({ server, id }, { focus })` focuses an already open session instead of
  duplicating it.
- Server events include `session.created` and `session.execution.succeeded`; state
  derivation does not depend on event names, only on the reactive store.
- HTML5 drag events are enough: the board renders inside a single Settings page, so no
  iframe or cross-window drag is involved.

## Risks

| Risk | Mitigation |
|---|---|
| Session created but prompt fails (orphan) | Keep the session, store the id, expose "Send prompt again" |
| Double drop creates two sessions | In-memory start guard plus a stored `sessionID` re-check before create |
| Reactive store misses an update | 3 s fallback timer while the card is in Doing |
| Provider signed out | Surface the client error on the card; never swallow it |
| Sidecar restart changes client identity | Read `ctx.servers.get("sidecar")` on every call, never cache the client |
| Drag on a scrolled column strip loses the target | Keep the highlight on `dragover` only, cancel on `dragleave`, and test at 900 px |
| Drop on Ready races the dialog path | Both paths call the same guard in `startTask` |

## Out of scope for P2

Permissions, questions, error analysis, lessons, stopping a run, concurrency limits,
worktrees, task templates.
