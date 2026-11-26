# Foreman

A task board for OpenCode Desktop. A card is a **task**, not a chat. Dragging a task
to **Ready** starts an OpenCode session for it; the board follows that run and tells
you when it is working, waiting on you, or broken — until you move it to **Done**.

> **Status: P1 implementation complete.** P2 and P3 are specification only.
> Phases: `specs/001-board/` (P1), `specs/002-run/` (P2), `specs/003-intervene/` (P3).

## The loop

```
TODO  backlog you write
  │ drag                                    (P1: column is set from the task dialog)
  ▼
READY ──► create session + prompt ──► DOING   (P2)
                                       ├─ working          agent is running
                                       ├─ action required  permission / question
                                       │    └─ Approve, Always, Reject / answer ──► DOING
                                       ├─ unread           finished, you have not read it
                                       │    └─ open + follow-up ──► DOING
                                       └─ error            run failed
                                            └─ analyse lesson / retry ──► DOING
DONE ◄── drag after you have read the outcome   (P2)
```

## Docs

| Phase | Spec | Plan | Tasks |
|---|---|---|---|
| P1 — Board and task store | [spec](specs/001-board/spec.md) | [plan](specs/001-board/plan.md) | [tasks](specs/001-board/tasks.md) |
| P2 — Run the task | [spec](specs/002-run/spec.md) | [plan](specs/002-run/plan.md) | [tasks](specs/002-run/tasks.md) |
| P3 — Intervene | [spec](specs/003-intervene/spec.md) | [plan](specs/003-intervene/plan.md) | [tasks](specs/003-intervene/tasks.md) |

Shared entity model: [specs/001-board/data-model.md](specs/001-board/data-model.md).
Project rules: [.specify/memory/constitution.md](.specify/memory/constitution.md).

## P1 local development

```powershell
npm install
npm test -- --run
npm run build
npm run watch
```

Open `/settings?tab=foreman` in OpenCode Desktop or use `foreman.open-board`
from the command palette. The watch build reloads the local GUI plugin.

## Fixed decisions

- **Form factor:** one OpenCode Desktop GUI plugin, package `foreman`, id `foreman`.
- **Surface:** a **dedicated board page** — a `SettingsPage` with id `foreman`, rendered at
  `/settings?tab=foreman` and opened by the command `foreman.open-board`, which calls
  `ctx.layout.settings("foreman")`. The GUI API has no standalone window; a dedicated page
  is the closest surface that belongs to no single session. A compact side-panel mirror is
  a later, optional addition — not part of P1.
- **Store:** `Store.global` in the plugin, one array of tasks. The database is never
  touched directly.
- **Card ↔ session:** one task owns at most one session. Follow-ups and retries stay in
  that session.
- **Board scope:** tasks from every project; each card shows its project.
- **P1 is render + create/edit/delete.** No drag-and-drop and no session work: a column is
  changed from the task's edit dialog. Dragging, and Ready starting a run, arrive in P2.
- **Lessons are files:** P3 writes `docs/lessons/<date>-<slug>.md` inside the task's
  project. ai-memory is not written.

## Constraints

- GUI plugin API is `./gui-experimental`: it may change between OpenCode releases.
- Desktop only; the web app does not load GUI plugins.
- The plugin observes sessions through the OpenCode client and server events; it never
  writes the database.
- `deleted/` renamed sessions, re-auth prompts, and provider quota errors surface as
  task errors rather than being auto-handled.

## Open questions (need owner approval)

1. Concurrent runs: unlimited (proposed) vs. a configurable cap.
2. UI copy language: English first (proposed), Vietnamese locale after.
