# Data Model — Foreman

Shared by P1, P2 and P3. Stored in the plugin's `Store.global` under one key,
`tasks`, an array of `Task`. No OpenCode database table is read or written.

## Task

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `id` | string | yes | generated | UUID v4; never reused |
| `title` | string | yes | owner | 1–200 chars, trimmed |
| `description` | string | no | owner | the prompt body used in P2 |
| `projectDirectory` | absolute path | yes | owner | resolved from OpenCode projects |
| `projectName` | string | no | derived | display only; refreshed on load |
| `agent` | string | no | owner | default `build` |
| `model` | `{ providerID, id }` | no | owner | absent = server default |
| `column` | `"todo" \| "ready" \| "doing" \| "done"` | yes | owner / P2 | P1 only writes todo/ready/done |
| `sessionID` | string | no | P2 | set when the run starts; at most one |
| `createdAt` | number (ms) | yes | system | |
| `updatedAt` | number (ms) | yes | system | drives column ordering |
| `startedAt` | number (ms) | no | P2 | when the session was created |
| `finishedAt` | number (ms) | no | P2 | when the owner moved it to Done |
| `lastError` | string | no | P3 | short message from the failed run |
| `lesson` | `Lesson` | no | P3 | filled by the analysis flow |

Card ordering inside a column: `updatedAt` descending, then `id` ascending.

## Lesson (P3)

| Field | Type | Notes |
|---|---|---|
| `whatFailed` | string | agent's answer, first section |
| `fix` | string | second section |
| `prevention` | string | third section |
| `savedPath` | string | markdown file written next to the project |
| `savedAt` | number (ms) | |

## Derived run state (not stored)

`RunState` is computed from the OpenCode session of the task, never persisted. One value
per task:

| State | Rule | Where |
|---|---|---|
| `action_required` | a pending permission request or pending question form exists | P3 |
| `error` | last turn outcome is `failed`, or the session reports an error | P3 |
| `working` | `time.busy > time.idle` | P2 |
| `unread` | `time.idle >= time.viewed` and not busy | P2 |
| `reviewed` | finished, viewed, no action pending | P2 |
| `none` | no session yet, or session missing | P2 |

Precedence: `action_required` → `error` → `working` → `unread` → `reviewed`.

## Session mapping

- `Task.sessionID` is created once by P2 and never replaced. Retry and follow-up reuse
  the same session.
- If the session is deleted outside Foreman, the task keeps `sessionID`; `RunState`
  becomes `none` and the card offers "Start a new session" (P3).
- A session whose `parentID` is set (subagent) is never adopted by a task.

## Store schema (Effect Schema, simplified)

```ts
const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  projectDirectory: Schema.String,
  projectName: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.Struct({
    providerID: Schema.String,
    id: Schema.String,
  })),
  column: Schema.Literal("todo", "ready", "doing", "done"),
  sessionID: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
})
```

Corrupt or older stored values are coerced to an empty array; the board shows a
dismissible warning instead of failing.

## Invariants

1. `column === "doing"` implies `sessionID` is set (P2 onwards).
2. A task has at most one session.
3. Moving to Done sets `finishedAt`; moving back to Todo/Ready clears it.
4. `updatedAt` changes on every owner-visible mutation.
5. Deleting a task never deletes its session.
