# Tasks: Intervene (P3)

**Input**: Design documents from `specs/003-intervene/`

**Prerequisites**: `plan.md`, `spec.md`, P2 complete, `specs/001-board/data-model.md`

**Tests**: decision logic (`run-state`, `errors`, `lesson`, `answers`) is unit-tested
first. Approve / question / stop / lesson flows are verified manually in the desktop app
because they require a live agent turn.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational

- [ ] T001 [P] Extend `tests/run-state.test.ts` with `action_required`, `error`, `stopped`
  and precedence cases; watch it fail.
- [ ] T002 [P] Write failing tests in `tests/errors.test.ts` for classification of auth,
  quota, rate limit, model, network, tool and unknown errors, plus `interrupted → stopped`.
- [ ] T003 [P] Write failing tests in `tests/lesson.test.ts` for the prompt template and
  three-section parsing (complete, partial, free-form).
- [ ] T004 [P] Write failing tests in `tests/answers.test.ts` for required-field validation
  per `Form.Field` variant.
- [ ] T005 Implement the extensions in `src/domain/run-state.ts`, `src/domain/errors.ts`,
  `src/domain/lesson.ts`, `src/domain/answers.ts` until T001–T004 pass.
- [ ] T006 Add `lastError`, `lesson`, `lessonInFlight` to the task store helpers and to the
  `Task` schema (optional fields only).

**Checkpoint**: every decision in P3 is a pure function with tests; nothing talks to a
server yet.

---

## Phase 2: User Story 1 — See when a run needs me (P1) 🎯 MVP

**Goal**: a blocked card shows `action_required` with a count and a notification fires when
the board is hidden.

**Independent Test**: trigger a permission request from a task session; the card updates
within 5 s and a notification appears while another tab is focused.

- [ ] T007 [US1] Implement `src/gui/run/requests.ts`: `createResource` over
  `client.session.permission.list` and `client.session.form.list`, keyed by `sessionID`.
- [ ] T008 [US1] Subscribe to `permission.asked`, `permission.replied`, `form.created`,
  `form.replied`, `form.cancelled` and invalidate the resource.
- [ ] T009 [US1] Add the bounded 3 s poll and a window-focus re-read; stop both when the
  card leaves Doing or the panel unmounts.
- [ ] T010 [US1] Feed the counts into `deriveRunState` and render the `action_required`
  badge on `TaskCard.tsx` with a distinct colour and icon.
- [ ] T011 [US1] Notify on the transition into `action_required`, debounced 30 s per task,
  only when the board is not the active surface.
- [ ] T012 [US1] Manual acceptance: request appears, request resolved externally clears the
  badge, two tasks blocked at once, notification while hidden.

**Checkpoint**: waiting work can no longer be missed.

---

## Phase 3: User Story 2 — Approve from the card (P1)

- [ ] T013 [US2] Build `src/gui/board/ApprovalPanel.tsx`: action, resources list, source
  label, message, and the three decisions.
- [ ] T014 [US2] Implement `src/gui/run/reply.ts` `replyPermission` with optimistic
  disable, `Sending…` state, and reconciliation by re-reading the list.
- [ ] T015 [US2] Require a message for `reject`; validate before sending.
- [ ] T016 [US2] Handle 404 as "expired": remove the request, show a note, re-derive state.
- [ ] T017 [US2] Handle other failures inline on the panel with a retry affordance.
- [ ] T018 [US2] Manual acceptance: once, always (request does not reappear), reject with
  message, double-click protection, expired request, approval from the app UI instead.

**Checkpoint**: the highest-frequency intervention happens inside the board.

---

## Phase 4: User Story 3 — Answer a question (P1)

- [ ] T019 [US3] Build `src/gui/board/QuestionPanel.tsx` rendering each `Form.Field`
  variant with the app's own controls.
- [ ] T020 [US3] Implement answer validation via `domain/answers.ts`; disable submit and
  name missing required fields.
- [ ] T021 [US3] Send `client.session.form.reply({ sessionID, formID, answer })`; clear the
  panel on success.
- [ ] T022 [US3] Implement cancel with `client.session.form.cancel` (DELETE) and record
  `cancelled` on the store entry.
- [ ] T023 [US3] Fall back to "Open session" for external fields the board cannot render.
- [ ] T024 [US3] Manual acceptance: single-choice, multi-field, validation error, cancel,
  replaced form, external field.

**Checkpoint**: questions no longer require leaving the board.

---

## Phase 5: User Story 4 — See and understand a failure (P1)

- [ ] T025 [US4] Derive `error` from session `outcome === "failed"` and
  `session.execution.failed`; derive `stopped` from `outcome === "interrupted"`.
- [ ] T026 [US4] Persist `lastError` (classified line + raw message) and clear it on the next
  `session.execution.started`.
- [ ] T027 [US4] Render the error line on the card (truncated) and the full classified error
  plus raw message in the detail.
- [ ] T028 [US4] Add Retry on error and stopped cards: one prompt to the existing session,
  never a new session.
- [ ] T029 [US4] Manual acceptance: invalid model, signed-out provider, forced tool failure,
  owner interrupt (shows stopped), retry after each, restart keeping `lastError`.

**Checkpoint**: a failed run can never be mistaken for an idle one.

---

## Phase 6: User Story 5 — Learn from the failure (P2)

- [ ] T030 [US5] Build `src/gui/board/LessonPanel.tsx`: three empty sections, the exact
  prompt preview, and the Analyse action.
- [ ] T031 [US5] Implement `src/gui/run/lesson.ts`: guard, send the fixed prompt, wait for
  idle with a 120 s timeout, read the last assistant text.
- [ ] T032 [US5] Parse into `lesson.whatFailed|fix|prevention`; keep the raw answer and set
  `incomplete` when parsing fails.
- [ ] T033 [US5] Write `docs/lessons/YYYY-MM-DD-<slug>.md` under the task's project with
  path-traversal rejection; record `savedPath`.
- [ ] T034 [US5] Keep the lesson in the store when the write fails and show the attempted
  path.
- [ ] T035 [US5] Add Copy and "Open in editor" for a saved lesson.
- [ ] T036 [US5] Manual acceptance: complete answer, partial answer, free-form answer,
  read-only project, restart mid-generation, second Analyse on an existing lesson.

**Checkpoint**: every failure can become a durable lesson.

---

## Phase 7: User Story 6 — Stop a run (P3)

- [ ] T037 [US6] Add Stop to the card with `ctx.dialogs.confirm` explaining the consequence.
- [ ] T038 [US6] Implement `src/gui/run/stop.ts`: interrupt, wait for
  `session.execution.interrupted` or idle, timeout to a visible failure.
- [ ] T039 [US6] Reuse the existing session when a stopped card returns to Ready or retries.
- [ ] T040 [US6] Manual acceptance: stop a long run, stop during a permission prompt, stop
  failure path, restart after stop, move stopped card to Ready.

**Checkpoint**: the owner can always regain control of a run.

---

## Phase 8: Polish

- [ ] T041 [P] Cap concurrent request panels and virtualise long resource lists.
- [ ] T042 [P] Add keyboard paths: `A` approve once, `Shift+A` always, `R` reject, `Esc`
  collapse, on a focused card.
- [ ] T043 [P] Ensure every panel state is reachable with a screen reader label and the
  focus returns to the card after a reply.
- [ ] T044 [P] Document the intervention flow, error classes and lesson format in
  `README.md`.
- [ ] T045 Run the full P3 quickstart (approve, question, fail, lesson, stop) and record the
  result.
- [ ] T046 Verify no code path can reply without an explicit owner action (grep for the reply
  helpers' call sites; only the two panels may call them).

---

## Dependencies

- Phase 1 blocks all stories.
- US1 blocks US2 and US3 (they render inside the detected requests).
- US4 is independent of US1–US3 except for card layout; it can start once Phase 1 lands.
- US5 depends on US4 (`error` state and `lastError`).
- US6 is independent and can be built in parallel with US5.

## Parallel opportunities

- T001–T004 are parallel; T005 then proceeds per module.
- T013/T019/T025/T037 touch different components and can proceed together after Phase 1.
- T041–T044 are independent polish items.

## MVP

Phases 1–2 (detect blocked runs) plus Phase 3 (approve) deliver P3's core value: no blocked
task is invisible. Validate that before building questions, errors and lessons.
