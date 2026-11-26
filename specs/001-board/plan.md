# Implementation Plan: Foreman Board (P1)

**Branch**: `001-board` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-board/spec.md`

## Summary

Ship the first OpenCode Desktop GUI plugin for Foreman: a registered side panel that
renders four columns of locally stored tasks, with create, edit, delete, drag-between-
columns, filtering and persistence. P1 never talks to a session. It establishes the
package, the build, the Effect-Schema task model, the store, and the board components
that P2 and P3 extend.

## Technical Context

**Language/Version**: TypeScript 5.x, SolidJS 1.9, Vite 7

**Primary Dependencies**: `@opencode/plugin` (types), `@opencode/plugin/gui` (host
provided at runtime), `effect` (Schema, host provided), `solid-js` (host provided),
`vite-plugin-solid`

**Storage**: `Store.global` declared in `Plugin.define({ stores })`; one array of tasks
under the plugin key prefix. No filesystem and no database access in P1.

**Testing**: Vitest for pure domain logic (`src/domain/*`). GUI acceptance is manual
against a running desktop app; there is no Electron E2E harness.

**Target Platform**: OpenCode Desktop 2.0.4+ on Windows, macOS, Linux. The web app does
not load GUI plugins; the plugin must fail quietly there.

**Project Type**: Single-package desktop GUI plugin (no server part, no TUI part).

**Performance Goals**: board opens under 300 ms with 100 tasks; drag feedback under one
frame; no layout thrash while cards move.

**Constraints**: `./gui-experimental` must be one prebuilt CommonJS file; the host
provides `effect`, `solid-js`, `@opencode/*` and must not be bundled; the panel's width
is bounded by the side region (the user can drag the tab to the bottom pane).

**Scale/Scope**: personal board, up to a few hundred tasks, 4 columns, 6 components.

## Constitution Check

No constitution file exists in this repository (fresh clone). The gates applied for this
phase:

1. **No session side effects in P1** — pass: P1 imports no session API.
2. **No direct database access** — pass: state lives in the plugin store only.
3. **Host-provided modules only** — pass: the Vite `gui()` preset enforces this.
4. **Degrade, don't crash** — pass: corrupt store and missing projects render warnings.

## Project Structure

### Documentation (this feature)

```text
specs/001-board/
├── spec.md          # this feature's specification
├── plan.md          # this file
├── data-model.md    # shared entity model
└── tasks.md         # implementation tasks
```

### Source Code (repository root)

```text
package.json
tsconfig.json
vite.config.ts
src/
├── gui.tsx                     # ./gui-experimental entry: Plugin.define
├── gui/
│   ├── definition.ts           # id, stores, i18n
│   ├── window.tsx              # setup: Panel + Command + MenuItem
│   └── board/
│       ├── Board.tsx           # columns, scroll, filter bar
│       ├── Column.tsx          # drop target, header count, empty state
│       ├── TaskCard.tsx        # card render
│       ├── TaskDialog.tsx      # create/edit form
│       └── styles.ts           # inline CSS via ctx.add(Styles)
├── domain/
│   ├── task.ts                 # Task schema, factory, validation
│   ├── columns.ts              # grouping + ordering + counts
│   └── filters.ts              # project filter + title search
├── i18n/en.ts
└── stores.ts                   # Store.global declaration
tests/
├── columns.test.ts
├── filters.test.ts
└── task.test.ts
```

**Structure Decision**: single package at the repository root, because the repository is
the plugin. Domain logic is kept free of Solid and of `ctx` so it is unit-testable
without the desktop host.

## Decisions

### D1 — Board surface: side panel (proposed)

The SDK has no full-window page registry. Available surfaces are a session side panel, a
Settings page, and four slots. A board needs horizontal room and should be reachable
while working, so P1 registers `Panel` with `region: "side"` and a wide `width`, plus a
command and a `session.panel` menu item. The host lets the user drag the tab into the
bottom pane, which gives full width.

Alternatives rejected: Settings page (roomy but buried in settings and semantically
wrong); `window.bottom` slot (full width but too short for four columns).

**Needs owner confirmation** — see README open question 1.

### D2 — State: `Store.global`

```ts
stores: {
  tasks: Store.global(Schema.Array(Task), []),
}
```

Read `ctx.stores.tasks.value`, mutate with `update(draft => …)`, replace with `set`.
The host persists and prefixes the key; no migration code in P1. A schema mismatch is
caught and reset to `[]` with a warning.

### D3 — Command and keybind

Command id `open-board`, published as `foreman.open-board`, keybind `mod+shift+b`,
`section: "session"`, `enabled` when a session is routed. It toggles the panel with
`ctx.layout.toggle(\`${ctx.id}:board\`, session)`. A `session.panel` menu item opens it
too, so it is discoverable from the side region launcher.

### D4 — Drag and drop

HTML5 drag events on cards and columns (`draggable`, `dragstart`, `dragover`,
`drop`, `dragend`), with a CSS class for the active drop target. On drop, P1 writes the
new column and `updatedAt`. Doing is a drop target but rejects drops with a tooltip
("Doing is managed by runs"), which keeps the visual model honest and avoids a dead
column.

### D5 — Project picker

Read known projects from the OpenCode client (`project.list`) for the sidecar server.
The picker shows name plus path, searchable. A manual path field is a fallback, validated
as absolute. `projectName` is derived at save time and refreshed when the board loads.

### D6 — i18n

English only in P1 (`i18n.en`). UI strings live in `i18n/en.ts` and are read through
`ctx.t`, so adding Vietnamese later is additive.

## Research notes (verified against OpenCode 2.x)

- GUI entry must build to one `.cjs` via `gui()` from `@opencode/plugin/gui/vite`.
- The plugin id comes from the package name when there is no server part; `foreman` is
  safe (it is not in the reserved `opencode` namespace).
- `ctx.add(Panel, …)` requires a stable `PanelTab` object returned from `list`, with
  titles read from getters.
- `ctx.layout.toggle/open/close` work by key `<plugin id>:<tab id>`.
- `ctx.commands`/`ctx.keybinds` are host-provided; no extra dependency is needed.
- Local plugin directories reload the GUI on every rebuild (`vite build --watch`).

## Risks

| Risk | Mitigation |
|---|---|
| Experimental GUI API changes | Pin the OpenCode version in development notes; keep host calls inside `gui/` wrappers |
| Panel too narrow for four columns | Columns scroll horizontally; document the drag-to-bottom-pane route |
| Store shape changes between phases | Single `Task` schema in `domain/task.ts`, additive optional fields only |
| Solid reactivity mistakes (destructured props) | Lint rule/review note: read props where used, never destructure panel inputs |

## Out of scope for P1

Session creation, live run state, permissions, questions, error handling, lessons,
multi-user sync, task templates, recurring tasks.
