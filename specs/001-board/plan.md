# Implementation Plan: Foreman Board (P1)

**Branch**: `001-board` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-board/spec.md`

## Summary

Ship the first OpenCode Desktop GUI plugin for Foreman: a dedicated board page that
renders four columns of locally stored tasks, with create, edit, delete, a column field,
filtering and persistence. P1 never talks to a session. It establishes the package, the
build, the Effect-Schema task model, the store, and the board components that P2 and P3
extend.

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

**Performance Goals**: board opens under 300 ms with 100 tasks; a column change renders
under one frame; no layout thrash while cards move between columns.

**Constraints**: `./gui-experimental` must be one prebuilt CommonJS file; the host
provides `effect`, `solid-js`, `@opencode/*` and must not be bundled; the board renders
inside a Settings page, so it must respect the app's settings layout and scroll container.

**Scale/Scope**: personal board, up to a few hundred tasks, 4 columns, 6 components.

## Constitution Check

Gates from [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md):

1. **Article I — owner decides** — pass: P1 has no automated action at all.
2. **Article II — never touch the database** — pass: state lives in the plugin store only.
3. **Article IV — pure decisions** — pass: grouping, ordering, filtering and validation live
   in `src/domain/` with tests.
4. **Article V — degrade** — pass: a corrupt store and missing projects render warnings.
5. **Article VIII — isolate the API** — pass: every host import stays under `src/gui/`.

## Project Structure

### Documentation (this feature)

```text
specs/001-board/
├── spec.md          # this feature's specification
├── plan.md          # this file
├── data-model.md    # shared entity model
├── quickstart.md    # install, build, and verify the board
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
│   ├── window.tsx              # setup: SettingsPage + Command
│   └── board/
│       ├── BoardPage.tsx       # page shell inside ui.SettingsLayout
│       ├── Board.tsx           # columns, horizontal scroll, filter bar
│       ├── Column.tsx          # header count, empty state, card list
│       ├── TaskCard.tsx        # card render
│       ├── TaskDialog.tsx      # create/edit form incl. the column field
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

### D1 — Board surface: a dedicated page (decided)

The GUI API has no standalone window: `Panel` is scoped to a session's side region, the
four `Slot`s are strips inside the window, and `SettingsPage` is the only full-width page a
plugin can own. The owner asked for one board of its own, not a panel attached to whichever
chat is open, so P1 registers:

```ts
ctx.add(SettingsPage, {
  id: "foreman",                    // /settings?tab=foreman
  icon: "layout",
  get title() { return ctx.t("board.title") },
  render: () => <BoardPage />,
})
```

and a command `foreman.open-board` whose `run` is `ctx.layout.settings("foreman")`. The
page renders inside `ui.SettingsLayout`, so it inherits the app's chrome, scrolling and
search.

Trade-off accepted: the board replaces the chat while it is open; the command is one
keystroke away. A compact side-panel mirror is a later optional addition, not P1.

Alternatives rejected: session side panel (belongs to one session, too narrow for four
columns); `window.bottom` slot (always visible but too short); a separate Electron window
(no API).

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
`section: "navigation"`, always enabled. Its `run` calls
`ctx.layout.settings("foreman")`; a second invocation focuses the same page. No panel key
and no menu item are needed, because the page is reachable from any screen.

### D4 — Column changes, no drag and drop

P1 has no drag-and-drop. The `column` field lives in `TaskDialog` as a select with Todo,
Ready and Done (Doing is disabled with the reason "Doing is managed by runs"), and saving
writes `column` plus `updatedAt`; moving to Done sets `finishedAt`, moving out of Done
clears it. The card reacts immediately because the board reads the store reactively.

Drag-and-drop is deferred to P2, where Ready has a consequence (it starts the run). P2 adds
the drag layer on top of the same store writes, so the dialog stays a working fallback.

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
- `SettingsPage.id` doubles as the settings tab value (`/settings?tab=foreman`) and the
  argument to `ctx.layout.settings(page)`.
- `SettingsPage` takes a stable `render`; its `title`, `icon` and `entries` are read from
  getters so the language and search follow.
- `Command.section` accepts `"navigation"`; `run` may open the settings page directly.
- Local plugin directories reload the GUI on every rebuild (`vite build --watch`).

## Risks

| Risk | Mitigation |
|---|---|
| Experimental GUI API changes | Pin the OpenCode version in development notes; keep host calls inside `gui/` wrappers |
| Settings layout constrains width or scroll | Render inside `ui.SettingsLayout`; columns scroll horizontally and are tested at 900 px |
| Owner cannot find the board inside Settings | Command `foreman.open-board` with `mod+shift+b`, plus a settings search entry |
| Store shape changes between phases | Single `Task` schema in `domain/task.ts`, additive optional fields only |
| Solid reactivity mistakes (destructured props) | Read props where used; never destructure |

## Out of scope for P1

Drag-and-drop between columns (arrives in P2), session creation, live run state,
permissions, questions, error handling, lessons, multi-user sync, task templates,
recurring tasks.
