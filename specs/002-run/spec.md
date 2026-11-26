# Feature Specification: Run the Task (P2)

**Feature Branch**: `002-run`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Ready starts OpenCode working on the task, then the card
moves to Doing. Doing shows whether the agent is working or whether the result is unread.
Reading it can lead to a follow-up; the owner drags it to Done when satisfied."

## User Scenarios & Testing

### User Story 1 - Ready starts the work (Priority: P1)

The owner drags a task from Todo to Ready. Foreman creates an OpenCode session in the
task's project, sends the task description as the first prompt, stores the session id on
the task, and the card appears in Doing.

**Why this priority**: This is the product's reason to exist; without it the board is a
static list.

**Independent Test**: Drag one Ready task whose project is a real directory; confirm a
session exists with the task title, receives the prompt, and the card moves to Doing.

**Acceptance Scenarios**:

1. **Given** a task in Todo with a valid project, **When** it is dropped on Ready,
   **Then** a session is created in that directory, the prompt is sent, and the card
   shows in Doing with `working`.
2. **Given** the same task dropped on Ready twice in quick succession, **Then** exactly
   one session is created.
3. **Given** a task whose project directory no longer exists, **When** it is dropped on
   Ready, **Then** no session is created, the card returns to Todo, and an error explains
   why.
4. **Given** the provider is signed out, **When** the run starts, **Then** the failure is
   reported on the card and the task is not silently lost.

---

### User Story 2 - See what the run is doing (Priority: P1)

While a task is in Doing, the card shows its run state: `working` while the agent is
running, `unread` when a turn finished and the owner has not opened it, `reviewed` once
the owner has read it, and a neutral state if the session vanished.

**Why this priority**: The board must be trustworthy at a glance; a stale card makes the
owner open sessions manually.

**Independent Test**: Start a task, watch the card go `working`, then `unread`; open the
session and confirm it becomes `reviewed` without a manual refresh.

**Acceptance Scenarios**:

1. **Given** a session is running, **When** the board renders, **Then** the card shows
   `working` with elapsed time.
2. **Given** the agent finished a turn and the owner has not viewed the session,
   **Then** the card shows `unread`.
3. **Given** the owner opened the session, **Then** the card shows `reviewed` within
   5 seconds.
4. **Given** the session was deleted outside Foreman, **Then** the card shows a neutral
   "session missing" state and keeps the task in Doing until the owner acts.

---

### User Story 3 - Read the result (Priority: P1)

Clicking a card opens its session as a focused tab, so the owner reads the real
transcript in the app's normal UI.

**Why this priority**: The board should not reimplement chat; it routes to the session.

**Independent Test**: Click a Doing card and confirm the session tab opens focused and
the card turns `reviewed`.

**Acceptance Scenarios**:

1. **Given** a Doing card, **When** the owner clicks it, **Then** the session opens as a
   focused tab.
2. **Given** the session is already open, **When** the card is clicked, **Then** its tab
   is focused, not duplicated.
3. **Given** the owner returns to the board, **Then** the card state reflects the visit.

---

### User Story 4 - Continue the conversation (Priority: P2)

From the card, the owner sends a follow-up prompt to the same session without leaving the
board.

**Why this priority**: Most tasks need one or two corrections before Done.

**Independent Test**: Send "also add tests" from a reviewed card; confirm the message
lands in the same session and the card returns to `working`.

**Acceptance Scenarios**:

1. **Given** a reviewed card, **When** the owner submits a follow-up, **Then** the text is
   sent to the existing session and the card shows `working`.
2. **Given** an empty follow-up, **Then** submit is disabled.
3. **Given** the session is running, **Then** a follow-up uses queue delivery rather than
   interrupting the run.

---

### User Story 5 - Finish the task (Priority: P2)

The owner drags a Doing card to Done once satisfied; Done records the finish time. Moving
it back to Todo or Ready is allowed and keeps the same session.

**Why this priority**: Closing the loop is what makes the board a workflow.

**Independent Test**: Drag a reviewed card to Done, restart, confirm `finishedAt` and the
column; drag it back to Todo and confirm the session id is unchanged.

**Acceptance Scenarios**:

1. **Given** a reviewed Doing card, **When** dropped on Done, **Then** `finishedAt` is set
   and the card leaves Doing.
2. **Given** a Done card, **When** dropped on Todo, **Then** it returns with its session
   still linked.
3. **Given** a running card, **When** dropped on Done, **Then** the owner is asked to
   confirm because the run continues in the background.

### Edge Cases

- Prompt text empty: send the title as the prompt, never an empty message.
- Very long description: sent as-is; if the server rejects it, the error is shown and the
  session is preserved for a retry.
- Session creation succeeds but the prompt fails: keep the session, mark the card with an
  error, and offer "Send prompt again" (no duplicate session).
- App closed while a run is active: on next load the card derives state from the session,
  not from a stale local flag.
- Server restart: ids survive; the board re-reads session info and reconnects.
- Task deleted while running: the session is left alone; only the card disappears.
- Two tasks pointing at the same project run concurrently: allowed.
- The owner moves a running card back to Ready: the session keeps running; P2 does not
  stop it (stopping arrives in P3).

## Requirements

### Functional Requirements

- **FR-001**: Dropping a task on Ready MUST create at most one session for that task.
- **FR-002**: The system MUST create the session in the task's `projectDirectory` with the
  task title, the chosen agent, and the chosen model (or server default).
- **FR-003**: The system MUST send the task description as the first prompt, falling back
  to the title when the description is empty.
- **FR-004**: On success the system MUST store `sessionID`, set `column: "doing"`, and set
  `startedAt`.
- **FR-005**: On failure the system MUST keep the task, return it to its previous column,
  and show a readable error.
- **FR-006**: The system MUST derive run state from session data: `working` when busy,
  `unread` when the last turn is newer than the last view, `reviewed` otherwise,
  `missing` when the session no longer exists.
- **FR-007**: State MUST update without a manual refresh and within 5 seconds of a change.
- **FR-008**: Clicking a card MUST focus the session tab, opening it if needed.
- **FR-009**: The system MUST send follow-ups to the task's existing session.
- **FR-010**: The system MUST NOT change a task's `sessionID` once set.
- **FR-011**: The system MUST NOT approve permissions, answer questions, or modify
  sessions on its own in P2.
- **FR-012**: Moving to Done MUST set `finishedAt`; moving out of Done MUST clear it.
- **FR-013**: The board MUST show elapsed run time for `working` cards and the last
  activity time for the rest.
- **FR-014**: The system MUST survive an unavailable sidecar server by showing a
  disconnected state instead of failing the board.

### Key Entities

- **Task** (see `specs/001-board/data-model.md`): gains `sessionID`, `startedAt`,
  `finishedAt` usage.
- **RunState**: derived, not stored — `working`, `unread`, `reviewed`, `missing`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Dropping a task on Ready produces a visible session tab in under 2 seconds
  on a warm app.
- **SC-002**: 100% of runs create exactly one session (no duplicates) across 20 trials
  including double drops.
- **SC-003**: `unread` clears within 5 seconds of opening the session, 9 out of 10 times.
- **SC-004**: After a restart, every Doing card shows the correct derived state without
  user action.
- **SC-005**: Zero sessions are created, prompted, or deleted by the board outside an
  explicit owner action.

## Assumptions

- The owner has already signed in to at least one model provider in OpenCode.
- Tasks target projects known to OpenCode; directories are absolute paths.
- The `sidecar` server is the app's own server and is the only server used.
- One session per task is enough; no worktrees are created per task in P2.
- English UI copy.
