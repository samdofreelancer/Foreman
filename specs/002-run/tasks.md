# Tasks: Run the Task (P2)

**Input**: Design documents from `specs/002-run/`

**Prerequisites**: `plan.md`, `spec.md`, P1 complete, `specs/001-board/data-model.md`

**Tests**: `run-state` and `start-guard` are unit-tested first. Session creation, tab
focus and live badges are verified manually in the desktop app.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational

- [ ] T001 [P] Write failing tests for run-state precedence in
  `tests/run-state.test.ts` (working, unread, reviewed, missing).
- [ ] T002 [P] Write failing tests for the start guard in `tests/start-guard.test.ts`
  (no session, already starting, wrong column, missing directory).
- [ ] T003 Implement `deriveRunState` in `src/domain/run-state.ts` until T001 passes.
- [ ] T004 Implement `canStart` in `src/domain/start-guard.ts` until T002 passes.
- [ ] T005 Add `sessionID`, `startedAt`, `finishedAt` usage to the task store helpers
  (additive optional fields; no migration needed).

**Checkpoint**: the decision layer is green; nothing talks to a server yet.

---

## Phase 2: User Story 1 — Ready starts the work (P1) 🎯 MVP

**Goal**: a Ready drop creates exactly one session and sends the first prompt.

**Independent Test**: drag one valid task to Ready; observe a session tab, the prompt in
the transcript, and the card in Doing.

- [ ] T006 [US1] Implement `startTask` in `src/gui/run/start-task.ts`: guard, create,
  store, prompt, failure path.
- [ ] T007 [US1] Wire `Board.tsx` so a drop on Ready calls `startTask` instead of only
  writing the column.
- [ ] T008 [US1] Add the in-memory `starting` set and the pre-create `sessionID` re-check.
- [ ] T009 [US1] On create failure, restore the previous column and show a readable error
  via a card-level message and a toast.
- [ ] T010 [US1] On prompt failure after create, keep the task in Doing with a
  "Send prompt again" action that calls `session.prompt` only.
- [ ] T011 [US1] Manual acceptance: happy path, double drop, missing directory, signed-out
  provider, restart during start.

**Checkpoint**: P2's core loop works for one task.

---

## Phase 3: User Story 2 — See what the run is doing (P1)

**Goal**: Doing badges derive from live session data.

**Independent Test**: start a task, watch `working` → `unread`, open it, watch `reviewed`.

- [ ] T012 [US2] Implement `src/gui/run/session-info.ts` reading
  `ctx.servers.get("sidecar")?.data.session.get(sessionID)` reactively.
- [ ] T013 [US2] Render the badge, elapsed time and last activity on `TaskCard.tsx` from
  `deriveRunState`.
- [ ] T014 [US2] Add the 3-second fallback timer while a card is in Doing, with cleanup.
- [ ] T015 [US2] Render the `missing` state when the session no longer exists.
- [ ] T016 [US2] Render a disconnected state on the board when the sidecar is unreachable.
- [ ] T017 [US2] Manual acceptance: state transitions without manual refresh, after a
  server restart, and with two concurrent runs.

**Checkpoint**: the board is trustworthy at a glance.

---

## Phase 4: User Story 3 — Read the result (P1)

- [ ] T018 [US3] Make a card click open/focus the session:
  `ctx.tabs.open({ server: "sidecar", id }, { focus: true })`.
- [ ] T019 [US3] Ensure keyboard activation (Enter/Space) does the same for accessibility.
- [ ] T020 [US3] Manual acceptance: open from card, re-click an open session (no duplicate
  tab), confirm the badge flips to reviewed.

**Checkpoint**: reading requires no tab hunting.

---

## Phase 5: User Story 4 — Continue the conversation (P2)

- [ ] T021 [US4] Build `src/gui/board/FollowUp.tsx` (textarea, submit, disabled when
  empty or not logged in).
- [ ] T022 [US4] Send with `delivery: "queue"` while the session is working.
- [ ] T023 [US4] Clear the composer and show `working` immediately after submit.
- [ ] T024 [US4] Manual acceptance: follow-up on reviewed card, follow-up during a run,
  send failure handling.

**Checkpoint**: corrections stay inside the board.

---

## Phase 6: User Story 5 — Finish the task (Medium)

- [ ] T025 [US5] On Done drop: confirm when the session is working, then set
  `finishedAt`.
- [ ] T026 [US5] On move out of Done: clear `finishedAt`, keep `sessionID`.
- [ ] T027 [US5] Manual acceptance: Done while reviewed, Done while working (confirm and
  cancel), move back to Todo, restart.

**Checkpoint**: the loop closes.

---

## Phase 7: Drag and drop (P2 addition)

**Goal**: cards move by dragging, without losing the dialog fallback.

- [ ] T028 Drag state module: `src/gui/board/drag.ts` with draggable ids, hovered column,
  and a pure `resolveDrop(state, target)` helper tested in `tests/drag.test.ts`.
- [ ] T029 `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` on cards and columns, with a
  highlight class for the active target and `Escape` cancelling.
- [ ] T030 Drop on Ready calls `startTask` (T006) instead of writing the column directly;
  drop on Doing shows "Doing is managed by runs" and keeps the origin column.
- [ ] T031 Manual acceptance: Todo→Ready starts, Todo→Done, Doing→Todo, cancelled drag,
  drop outside, narrow-window scroll during drag, keyboard alternative via the dialog.

**Checkpoint**: the board feels like a board, and P1's dialog still works.

---

## Phase 8: Polish

- [ ] T032 [P] Show model and agent on the card tooltip; show project path in the detail.
- [ ] T033 [P] Handle long titles/errors with truncation and tooltips.
- [ ] T034 Reduce re-renders: memoise column grouping; verify 20 running cards stay smooth.
- [ ] T035 [P] Document the P2 flow, drag rules and failure recovery in `README.md`.
- [ ] T036 Run the full P2 quickstart and record results.

---

## Dependencies

- Phase 1 blocks all stories.
- US1 blocks US2, US3, US4, US5 (they need a session to talk about).
- US2 blocks US3's badge verification but not US3's tab opening.
- US4 and US5 are independent of each other.
- Phase 7 depends on US1 (Ready must start a run) and US5 (`finishedAt` rules).

## Parallel opportunities

- T001 and T002 are parallel; T003 and T004 are parallel after them.
- T012, T021, T025 touch different files and can proceed together once T006 lands.
- T028 can be written before T029–T031; T032–T035 are independent polish items.

## MVP

Phase 2 alone (Ready → session + prompt) is a demonstrable increment even before badges
exist. Validate it, then add US2–US5, then Phase 7's drag layer.
