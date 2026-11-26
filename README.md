# Foreman

A task board for OpenCode Desktop. A card is a **task**, not a chat. Dragging a task
to **Ready** starts an OpenCode session for it; the board follows that run and tells
you when it is working, waiting on you, or broken — until you move it to **Done**.

> **Status: specification only.** No implementation exists yet.
> Phases: `specs/001-board/` (P1), `specs/002-run/` (P2), `specs/003-intervene/` (P3).

## The loop

```
TODO  backlog you write
  │ drag
  ▼
READY ──► create session + prompt ──► DOING
                                       ├─ working          agent is running
                                       ├─ action required  permission / question
                                       │    └─ Approve, Always, Reject / answer ──► DOING
                                       ├─ unread           finished, you have not read it
                                       │    └─ open + follow-up ──► DOING
                                       └─ error            run failed
                                            └─ analyse lesson / retry ──► DOING
DONE ◄── drag after you have read the outcome
```

## Docs

| Phase | Spec | Plan | Tasks |
|---|---|---|---|
| P1 — Board and task store | [spec](specs/001-board/spec.md) | [plan](specs/001-board/plan.md) | [tasks](specs/001-board/tasks.md) |
| P2 — Run the task | [spec](specs/002-run/spec.md) | [plan](specs/002-run/plan.md) | [tasks](specs/002-run/tasks.md) |
| P3 — Intervene | [spec](specs/003-intervene/spec.md) | [plan](specs/003-intervene/plan.md) | [tasks](specs/003-intervene/tasks.md) |

Shared entity model: [specs/001-board/data-model.md](specs/001-board/data-model.md).

## Fixed decisions

- **Form factor:** one OpenCode Desktop GUI plugin, package `foreman`, id `foreman`.
- **Surface:** a side panel (`region: "side"`) opened by `foreman.open-board`, which the
  user can drag to the bottom pane. The SDK has no full-window page; a Settings page
  could mirror the board later (P3 polish, optional).
- **Store:** `Store.global` in the plugin, one array of tasks. The database is never
  touched directly.
- **Card ↔ session:** one task owns at most one session. Follow-ups and retries stay in
  that session.
- **Board scope:** tasks from every project; each card shows its project.
- **P1 never starts a session.** Automation begins in P2.

## Constraints

- GUI plugin API is `./gui-experimental`: it may change between OpenCode releases.
- Desktop only; the web app does not load GUI plugins.
- The plugin observes sessions through the OpenCode client and server events; it never
  writes the database.
- `deleted/` renamed sessions, re-auth prompts, and provider quota errors surface as
  task errors rather than being auto-handled.

## Open questions (need owner approval)

1. Panel (proposed) vs. Settings page for the board surface.
2. Concurrent runs: unlimited (proposed) vs. a configurable cap.
3. Lesson destination: markdown file in the task project (proposed) vs. ai-memory page.
4. UI copy language: English first (proposed), Vietnamese locale after.
