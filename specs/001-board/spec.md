# Feature Specification: Foreman Board (P1)

**Feature Branch**: `001-board`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Kanban board for OpenCode sessions where a card is a task.
P1 is the board and the task store only; nothing runs yet."

## User Scenarios & Testing

### User Story 1 - See every task on one board (Priority: High)

The owner opens the Foreman board from the command palette and gets a dedicated page —
not a session panel — showing four columns: Todo, Ready, Doing, Done, filled with the
tasks they created across all their projects. Each card shows the task title, its
project, when it last changed, and its column.

**Why this priority**: Without the board there is no product; every later phase adds
behaviour to cards that must already exist.

**Independent Test**: Create three tasks in different projects, reopen the board, and
confirm they appear in the correct columns with the correct project labels.

**Acceptance Scenarios**:

1. **Given** no tasks exist, **When** the board opens, **Then** all four columns render
   with an explicit empty state and a "New task" action.
2. **Given** tasks exist in Todo, Ready and Done, **When** the board opens, **Then**
   each task shows in its own column and Doing renders a placeholder.
3. **Given** a narrow window, **When** the board opens, **Then** all four columns render
   with horizontal scrolling and no clipped card text.

---

### User Story 2 - Create a task (Priority: High)

The owner creates a task from the board: title, description (the prompt body), target
project directory, and optionally agent and model.

**Why this priority**: The board is useless without a way to enter the backlog.

**Independent Test**: Create a task with only a title and project; confirm it appears
in Todo and survives an app restart.

**Acceptance Scenarios**:

1. **Given** the new-task form, **When** the owner submits a title and picks a project,
   **Then** the task appears at the top of Todo and the form closes.
2. **Given** the new-task form, **When** title or project is empty, **Then** submit is
   disabled and the reason is shown.
3. **Given** a task was created, **When** the app restarts, **Then** the task is still
   in Todo with the same fields.

---

### User Story 3 - Edit or delete a task (Priority: Medium)

The owner renames a task, rewrites its description, changes its project, agent, model, or
column, or deletes it.

**Why this priority**: Tasks change as thinking changes; without edit/delete the board
rots.

**Independent Test**: Edit every field of a Todo task, then delete it; confirm the board
reflects both operations after restart.

**Acceptance Scenarios**:

1. **Given** a task, **When** the owner edits its title, **Then** the card shows the new
   title immediately and after restart.
2. **Given** a task, **When** the owner confirms delete, **Then** it disappears from the
   board and is not recreated on restart.
3. **Given** a delete prompt, **When** the owner cancels, **Then** nothing changes.

---

### User Story 4 - Set a task's column (Priority: Medium)

The owner changes a task's column from the task dialog, among Todo, Ready and Done. Doing
is not settable by hand: a card reaches Doing only when a run starts (P2). There is no
drag-and-drop in P1; the card is a record of intent, and the dialog is how intent changes.

**Why this priority**: The column must be settable before P2 can attach a run to Ready,
and persistence of the column is what makes P2 possible at all.

**Independent Test**: Change a task from Todo to Ready, then to Done, restart, and confirm
the column survives each change.

**Acceptance Scenarios**:

1. **Given** a Todo task, **When** its dialog's column is set to Ready, **Then** the card
   renders in Ready and the store records `column: "ready"`.
2. **Given** a Done task, **When** its column is set back to Todo, **Then** it returns to
   Todo and `finishedAt` is cleared.
3. **Given** a task being edited, **When** the dialog is cancelled, **Then** the column is
   unchanged.
4. **Given** a wide or narrow window, **When** a column is changed, **Then** the card
   moves immediately with no full-page reload.
5. **Given** the task dialog, **Then** Doing is shown as unavailable with the reason
   "Doing is managed by runs".

---

### User Story 5 - Find a task (Priority: Low)

The owner filters the board by project and searches by title.

**Why this priority**: Useful once the backlog is large, but not needed to prove the
board works.

**Independent Test**: With 20 tasks across 3 projects, filter to one project and search a
partial title; confirm only matching cards render.

**Acceptance Scenarios**:

1. **Given** tasks in three projects, **When** a project filter is chosen, **Then** only
   that project's cards render and column counts update.
2. **Given** a search string, **When** it matches part of a title, **Then** matching
   cards stay and others hide.
3. **Given** a filter and a search are both set, **Then** both apply.

### Edge Cases

- The stored task array is missing or corrupt: the board opens empty and shows a
  non-blocking error, never a blank screen.
- A task's project directory no longer exists: the card shows a "project missing" badge
  but stays usable (it cannot run in P2).
- Titles longer than one line truncate with a tooltip; very long descriptions are not
  rendered on the card.
- More than 100 tasks: rendering stays responsive because columns virtualise or cap at
  50 visible cards with a "show more" control.
- Two tasks with the same title are allowed; ids keep them distinct.
- The board is opened before the store has loaded: a short loading state, then the board.
- The board is opened on the web app (GUI plugins do not load): out of scope, but the
  plugin must not throw during load.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST contribute a dedicated board page (`SettingsPage` id
  `foreman`, reachable at `/settings?tab=foreman`) and a command `foreman.open-board`
  that opens it with `ctx.layout.settings("foreman")`.
- **FR-002**: The board MUST render four columns in this order: Todo, Ready, Doing, Done.
- **FR-003**: Each card MUST show title, project name, updated time, and column.
- **FR-004**: Users MUST be able to create a task with title and project directory;
  description, agent, and model are optional.
- **FR-005**: Users MUST be able to edit every task field except its id.
- **FR-006**: Users MUST be able to delete a task after an explicit confirmation.
- **FR-007**: Users MUST be able to set a task's column to Todo, Ready or Done from its
  edit dialog. Doing MUST NOT be settable by hand, and P1 MUST NOT implement drag-and-drop.
- **FR-008**: The system MUST persist all tasks across app restarts.
- **FR-009**: The board MUST show column counts and explicit empty states.
- **FR-010**: Users MUST be able to filter by project and search by title.
- **FR-011**: The system MUST NOT start, stop, or modify any OpenCode session in P1.
- **FR-012**: Every task MUST carry a stable id that survives edits and column changes.
- **FR-013**: Column order within a column MUST be deterministic and stable across
  restarts (updated time descending, then id).
- **FR-014**: The board MUST be usable at any window width: columns scroll horizontally
  and cards remain readable.
- **FR-015**: The plugin MUST load without a server part and without touching the
  OpenCode database.

### Key Entities

- **Task**: id, title, description, project directory, project name, agent, model,
  column, created/updated timestamps.
- **Column**: one of `todo`, `ready`, `doing`, `done`; a task has exactly one.
- **Project reference**: absolute directory plus display name resolved from the
  OpenCode project list.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A new user can create the first task and see it on the board in under 60
  seconds without reading documentation.
- **SC-002**: Tasks survive a full app restart with zero field loss (10/10 tasks).
- **SC-003**: Changing 20 tasks' columns leaves 20/20 in the intended columns after
  restart.
- **SC-004**: The board opens in under 300 ms with 100 stored tasks.
- **SC-005**: No board action ever creates, prompts, or deletes an OpenCode session.

## Assumptions

- The owner uses OpenCode Desktop 2.x where GUI plugins are supported.
- The board is a dedicated page inside Settings (`/settings?tab=foreman`), because the GUI
  API has no standalone window. Reaching it is one command away from any session.
- One board serves all projects; project grouping is a label and filter, not a separate
  board per project.
- Tasks are personal and local; no sharing, sync, or multi-user editing.
- The owner supplies the project directory by picking from known OpenCode projects;
  free-text paths are allowed only as a fallback.
- English UI copy ships first.
