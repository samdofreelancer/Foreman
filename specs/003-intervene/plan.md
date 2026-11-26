# Implementation Plan: Intervene (P3)

**Branch**: `003-intervene` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-intervene/spec.md`

## Summary

Close the loop on a running task. P3 teaches the board to recognise the three ways a Doing
card can need its owner — a pending permission or question (`action_required`), a failed
execution (`error`), or an owner interrupt (`stopped`) — render the actual request, answer
it in place, retry or stop the run, and turn a failure into a stored lesson written into
the project.

## Technical Context

**Language/Version**: TypeScript 5.x, SolidJS 1.9 (continues P1/P2)

**Primary Dependencies**: host-provided `@opencode/plugin/gui` and the sidecar client; no
new runtime packages

**Storage**: plugin store (`lastError`, `lesson`); one markdown file per lesson in the
task's project (`docs/lessons/`)

**Testing**: Vitest for `deriveRunState` extensions, lesson parsing, answer validation and
error classification; manual desktop acceptance for approve/question/interrupt flows

**Target Platform**: OpenCode Desktop 2.x

**Performance Goals**: request surface within 5 s; no poll faster than 3 s while a card is
in Doing; replies acknowledged optimistically but reconciled with a follow-up read

**Constraints**: never auto-answer; never create a second session for a retry; never write
the OpenCode database; lesson writes are confined to the task's project directory

**Scale/Scope**: tens of tasks, a few concurrent blocked runs

## Constitution Check

Gates from [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md):

1. **Article I — owner decides** — pass: every reply originates from a click; no rule engine.
2. **Article II — never touch the database** — pass: requests come from the client API,
   answers go back through it.
3. **Article III — one task, one session** — pass: retries reuse `sessionID`.
4. **Article V — degrade** — pass: expired request, missing form and read-only project all
   render as recoverable states.
5. **Article VIII — isolate the API** — pass: every client call lives in `gui/run/`.
6. **Article VI — transcript is authoritative** — pass: decisions are recorded locally, the
   session stays the source of truth.

## Project Structure

```text
src/
├── domain/
│   ├── run-state.ts            # extended precedence incl. action_required/error/stopped
│   ├── errors.ts               # classify StructuredError into a readable class
│   ├── lesson.ts               # prompt template + 3-section parser
│   └── answers.ts              # form answer validation
├── gui/
│   ├── run/
│   │   ├── requests.ts         # reactive pending permissions/forms for a session
│   │   ├── reply.ts            # permission + form reply calls, error reconciliation
│   │   ├── lesson.ts           # send lesson prompt, wait for turn, parse, write file
│   │   └── stop.ts             # interrupt
│   └── board/
│       ├── TaskCard.tsx        # badges, error line, action row
│       ├── ApprovalPanel.tsx   # permission detail + once/always/reject
│       ├── QuestionPanel.tsx   # form fields + submit/cancel
│       └── LessonPanel.tsx     # three sections, copy, saved path
tests/
├── run-state.test.ts           # extended
├── errors.test.ts
├── lesson.test.ts
└── answers.test.ts
```

**Structure Decision**: all decisions stay pure in `src/domain/`; the host-calling layer
only translates a decision into one client call and reconciles the result. This keeps the
dangerous part (answering on the owner's behalf) impossible to reach from a pure function.

## Design

### Detection

```ts
const server = ctx.servers.get("sidecar")
const perms  = createResource(() => task.sessionID, id => server?.client.session.permission.list(id))
const forms  = createResource(() => task.sessionID, id => server?.client.session.form.list(id))
```

- Subscribe to `permission.asked`, `permission.replied`, `form.created`, `form.replied`,
  `form.cancelled` to invalidate immediately.
- A 3 s poll runs only while the card is in Doing and the board is visible; it stops when
  the panel unmounts.
- Requests are keyed by session and never adopted for sessions without a task.

### Answering

```ts
await client.session.permission.reply({ sessionID, requestID, decision, message })
await client.session.form.reply({ sessionID, formID, answer })
```

- Optimistic UI: the button disables and shows "Sending…"; success is confirmed by the
  follow-up list read, not by the click.
- 404 on reply means the request expired: remove it, show a note, keep the card state
  derived from the session.
- `reject` requires a non-empty message in the UI (the message is what reaches the agent).

### Error classification

`Session.StructuredError` carries `type`, `message`, `status`, `retryAfterMs`. Map to a
small enum — `auth`, `quota`, `rate_limit`, `model`, `network`, `tool`, `unknown` — and a
human line. The raw `message` stays available in the detail. `outcome === "interrupted"`
maps to `stopped`, never `error`.

### Lesson flow

1. Guard: task in `error` or `stopped`, existing session, no lesson in flight.
2. Send one fixed prompt (stored in `domain/lesson.ts`, shown in the UI before sending):

```
The run failed. Answer in exactly three markdown sections and nothing else:
## What failed
## Fix
## Prevention
Be specific about the failing command or file, and keep each section under 120 words.
```

3. Wait for the turn to idle via the reactive session store (`busy > idle` transition) with
   a 120 s timeout.
4. Read the last assistant text from the session message list, parse the three headings.
5. Store the lesson, then write `docs/lessons/YYYY-MM-DD-<slug>.md` with frontmatter
   (`task`, `session`, `created`). A write failure keeps the lesson in the store and shows
   the path it tried.
6. Optionally offer "Copy as memory note"; no ai-memory call in P3.

### Stop

`client.session.interrupt({ sessionID })`, then wait for `session.execution.interrupted` or
an idle transition. On timeout, keep `working` and surface the failure.

### Notifications

`ctx.notifications` (or a toast when the app has no notification permission) fires only on
the transition into `action_required`, debounced per task to 30 s.

## Research notes (verified against OpenCode 2.x)

- `GET /api/session/{id}/permission` returns `Permission.Request[]`; the reply body is
  `{ decision: "once" | "always" | "reject", message?: string }`.
- `GET /api/session/{id}/form` returns `Form.Info[]`; the reply body is
  `{ answer: Record<string, Form.Value> }`; `DELETE` cancels a form.
- `POST /api/session/{id}/interrupt` interrupts execution.
- Events `permission.asked`, `permission.replied`, `form.created`, `form.replied`,
  `form.cancelled`, `session.execution.failed`, `session.execution.interrupted` exist in the
  server event union, so invalidation needs no polling in the happy path.
- `Session.Info.outcome` is `succeeded | failed | interrupted`; `Session.StructuredError`
  carries `type`, `message`, `status`, `retryAfterMs`.
- `Form.Field` variants: string, number, integer, boolean, multiselect, external — the
  external variant falls back to "open the session".

## Risks

| Risk | Mitigation |
|---|---|
| Double reply (board + app UI) | Disable after send, reconcile by re-reading; a 404 is treated as already answered |
| Stale request shown after expiry | Remove on 404, re-read on window focus |
| Lesson parser fails on free-form answers | Keep the whole answer in `whatFailed`, flag `lesson.incomplete` |
| Writing outside the project | Resolve `docs/lessons/` against `task.projectDirectory`, reject absolute or `..` paths |
| Interrupt leaves the session busy | Wait on both event and idle transition, then fall back to `error` with "still running" |
| Notification spam | Debounce per task, notify only on transition into `action_required` |

## Out of scope for P3

Bulk approve, approval rules/policies, multi-user review, ai-memory writes, automatic retry
with backoff, worktree isolation per task, analytics dashboards.
