# Tasks: Foreman Board (P1)

**Input**: Design documents from `specs/001-board/`

**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`

**Tests**: Domain logic is unit-tested with Vitest. GUI behaviour is checked manually
against OpenCode Desktop; there is no automated Electron harness in this phase.

**Organization**: Tasks are grouped by user story so each story can be validated alone.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1–US5 from `spec.md`

---

## Phase 1: Setup

- [ ] T001 Create `package.json` with `name: "foreman"`, `type: "module"`, `exports` for
  `./gui-experimental → ./dist/gui-experimental.cjs`, and scripts `build`, `watch`, `test`.
- [ ] T002 Create `vite.config.ts` using `gui()` from `@opencode/plugin/gui/vite`.
- [ ] T003 Create `tsconfig.json` with Solid JSX settings and `types: ["vite/client"]`.
- [ ] T004 [P] Add Vitest config and a `test` script covering `tests/**/*.test.ts`.
- [ ] T005 [P] Create `.gitignore` for `node_modules/`, `dist/`.

**Checkpoint**: `npm run build` produces `dist/gui-experimental.cjs` from a stub entry.

---

## Phase 2: Foundational

- [ ] T006 Implement the `Task` schema and factory in `src/domain/task.ts` per
  `data-model.md` (ids, timestamps, validation, `column` literals).
- [ ] T007 Implement `groupTasks`, `orderColumn`, `columnCounts` in
  `src/domain/columns.ts` (updatedAt desc, then id).
- [ ] T008 Implement `applyFilter` and `searchTasks` in `src/domain/filters.ts`.
- [ ] T009 Declare `Store.global` tasks in `src/stores.ts` and export read/update helpers.
- [ ] T010 [P] Create `src/i18n/en.ts` with every P1 string.
- [ ] T011 Create `src/gui/definition.ts` with `stores`, `i18n`, and no `os` restriction.
- [ ] T012 Create `src/gui.tsx` exporting `Plugin.define({ ...definition, setup })`.
- [ ] T013 [P] Unit tests in `tests/task.test.ts`, `tests/columns.test.ts`,
  `tests/filters.test.ts` (write before T006–T008 implementations and see them fail).

**Checkpoint**: domain tests pass; the plugin loads in the desktop app with no UI.

---

## Phase 3: User Story 1 — See every task on one board (P1) 🎯 MVP

**Goal**: four columns render stored tasks with counts, empty states and project labels.

**Independent Test**: seed 3 tasks across 2 projects, open `foreman.open-board`, confirm
placement, labels and counts.

- [ ] T014 [US1] Register the `Panel` in `src/gui/window.tsx` (`region: "side"`,
  `width`, stable `PanelTab`, `list` reading `input.open`).
- [ ] T015 [P] [US1] Build `src/gui/board/Board.tsx`: header, filter row placeholder,
  four columns, horizontal scroll.
- [ ] T016 [P] [US1] Build `src/gui/board/Column.tsx` (header, count, empty state) and
  `src/gui/board/TaskCard.tsx`.
- [ ] T017 [P] [US1] Add `src/gui/board/styles.ts` and register it with `ctx.add(Styles)`.
- [ ] T018 [US1] Register `Command` `open-board` (`mod+shift+b`, section `session`) and a
  `session.panel` `MenuItem` that toggles `${ctx.id}:board`.
- [ ] T019 [US1] Manual acceptance: empty board, seeded board, narrow panel, bottom-pane
  drag, app restart.

**Checkpoint**: the board is a usable read-only view of stored tasks.

---

## Phase 4: User Story 2 — Create a task (P1)

- [ ] T020 [US2] Build `src/gui/board/TaskDialog.tsx` create mode (title, description,
  project, agent, model).
- [ ] T021 [US2] Add the project picker backed by `client.project.list` for the sidecar
  server, with a validated manual-path fallback.
- [ ] T022 [US2] Wire submit to `stores.tasks.update`, validation errors, and immediate
  card insertion.
- [ ] T023 [P] [US2] Unit tests for task creation and validation in `tests/task.test.ts`.
- [ ] T024 [US2] Manual acceptance: title-only task, cancel, restart persistence.

**Checkpoint**: the backlog can be filled; US1 + US2 form the P1 demo.

---

## Phase 5: User Story 3 — Edit or delete a task (P2)

- [ ] T025 [US3] Reuse `TaskDialog` in edit mode; keep `id` and `createdAt` immutable.
- [ ] T026 [US3] Add delete with `ctx.dialogs.confirm` (`danger: true`) and store removal.
- [ ] T027 [P] [US3] Unit tests for immutable-field protection and delete semantics.
- [ ] T028 [US3] Manual acceptance: edit every field, cancel delete, confirm delete,
  restart.

**Checkpoint**: tasks are fully maintainable.

---

## Phase 6: User Story 4 — Move tasks between columns (P2)

- [ ] T029 [US4] Add drag state to `Board.tsx` (dragged id, hovered column).
- [ ] T030 [US4] Implement `dragstart`, `dragover`, `dragleave`, `drop`, `dragend` on
  cards and columns; persist `column` and `updatedAt` on drop.
- [ ] T031 [US4] Reject drops on Doing with a tooltip; reject drops outside a column.
- [ ] T032 [US4] Manual acceptance: Todo→Ready→Done→Todo, cancelled drag, restart,
  narrow-width horizontal scroll.

**Checkpoint**: the board behaves like a board.

---

## Phase 7: User Story 5 — Find a task (P3)

- [ ] T033 [US5] Add the filter bar (project select + debounced search) to `Board.tsx`.
- [ ] T034 [P] [US5] Unit tests for combined filter + search in `tests/filters.test.ts`.
- [ ] T035 [US5] Manual acceptance: 20 tasks / 3 projects, counts update, clear filters.

**Checkpoint**: large backlogs stay navigable.

---

## Phase 8: Polish

- [ ] T036 Guard the store: catch schema/parse failure, reset to `[]`, show a dismissible
  warning.
- [ ] T037 Cap rendered cards per column (50) with "show more" to keep 100+ tasks fast.
- [ ] T038 [P] Document local install and `vite build --watch` in `README.md`.
- [ ] T039 Verify the bundle imports only host-provided modules and stays under 200 KB.
- [ ] T040 Run the P1 quickstart end to end and record the result in the PR/commit.

---

## Dependencies

- Setup (Phase 1) blocks everything.
- Foundational (Phase 2) blocks all user stories.
- US1 blocks US2–US5 (they extend the board).
- US4 depends on US2 only for having tasks to drag.
- Polish depends on all stories.

## Parallel opportunities

- T004, T005, T010, T013 run in parallel.
- T015, T016, T017 run in parallel once T014's panel shape is agreed.
- T023, T027, T034 can be written in parallel with their UI.

## MVP

Phases 1–3 deliver a board that renders tasks. That is the P1 demo. Stop there, validate,
then proceed to US2/US3/US4/US5 in priority order.
