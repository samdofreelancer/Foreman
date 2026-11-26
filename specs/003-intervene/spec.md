# Feature Specification: Intervene (P3)

**Feature Branch**: `003-intervene`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "While a task is Doing it can need me in three ways.
Unread: I read it and may ask a follow-up. Action required: I review and press Approve so
it continues. Error: I ask what went wrong, what fixes it, and how to prevent it."

## User Scenarios & Testing

### User Story 1 - See when a run needs me (Priority: High)

A Doing card shows a distinct badge when its session is blocked on a permission request or
an open question, so the owner never has to hunt through sessions to find what is waiting.

**Why this priority**: Silent waiting is the failure mode that makes a board untrustworthy;
everything else in P3 depends on this signal.

**Independent Test**: Trigger a tool that asks for permission from a task's session; within
5 seconds the card shows `action required` and lists the request.

**Acceptance Scenarios**:

1. **Given** a Doing task whose session has a pending permission request, **When** the
   board renders, **Then** its card shows `action required` and the request count.
2. **Given** the pending request is resolved outside Foreman, **Then** the badge clears
   within 5 seconds without a manual refresh.
3. **Given** several tasks need attention, **When** the board is open, **Then** the
   attention cards are visually distinguishable from `working` and `unread`.
4. **Given** the board is not visible and a new request arrives, **Then** a notification
   (toast or app notification) names the task.

---

### User Story 2 - Approve from the card (Priority: High)

Without leaving the board the owner answers the pending permission request: once, always,
or reject, and can see what the request is for (action, resources, source).

**Why this priority**: Approving is the highest-frequency intervention; routing to the
session defeats the board.

**Independent Test**: From a card with a pending request, press Approve once; confirm the
run resumes and the badge returns to `working`.

**Acceptance Scenarios**:

1. **Given** a pending request, **When** the card is expanded, **Then** it shows the
   action, the resource list, and the requesting agent or tool.
2. **Given** the owner chooses `once`, **Then** the reply is sent with decision `once` and
   the badge clears.
3. **Given** the owner chooses `always`, **Then** the reply is sent with decision `always`
   and the same request never reappears for that session.
4. **Given** the owner chooses `reject` with a message, **Then** the decision is `reject`,
   the message is delivered, and the run continues in its error path.
5. **Given** the reply call fails, **Then** the request stays visible with an inline error
   and can be retried; the board never pretends the approval succeeded.

---

### User Story 3 - Answer a question (Priority: High)

When the agent asks the owner a structured question, the card renders the form's fields
and the owner answers them from the card.

**Why this priority**: A question blocks the run exactly like a permission does.

**Independent Test**: Prompt a task so the agent asks a multiple-choice question; answer
from the card and confirm the run resumes.

**Acceptance Scenarios**:

1. **Given** an open form, **When** the card expands, **Then** the title and all fields
   render with their input controls.
2. **Given** required fields are unanswered, **Then** submit is disabled and the missing
   fields are named.
3. **Given** a valid answer, **When** submitted, **Then** the reply is sent, the form
   closes, and the badge returns to `working`.
4. **Given** the owner cancels the form, **Then** the cancel endpoint is called and the
   card records that the question was dismissed.
5. **Given** the form changes while open, **Then** the card re-renders the latest version
   and warns that the form was replaced.

---

### User Story 4 - See and understand a failure (Priority: High)

A failed run is marked `error` with a short readable reason and the actions available
(retry the prompt, open the session, or analyse the lesson).

**Why this priority**: Without it a failed run looks like an idle one and the owner waits
for nothing.

**Independent Test**: Force a failure (invalid model or aborted provider) and confirm the
card shows `error`, the message, and a retry action.

**Acceptance Scenarios**:

1. **Given** a session execution fails, **Then** the card shows `error` with the failure
   message, truncated on the card and complete in the detail.
2. **Given** the failure is a provider/quota/auth error, **Then** the card names the class
   of failure instead of showing a raw payload.
3. **Given** the run was interrupted by the owner, **Then** the card shows `stopped`, not
   `error`.
4. **Given** an error card, **When** the owner presses Retry, **Then** a prompt is sent to
   the same session and the card returns to `working`.
5. **Given** an error, **Then** the task keeps its session and `lastError` in the store, so
   the failure survives a restart.

---

### User Story 5 - Learn from the failure (Priority: Medium)

From an error card the owner runs a lesson analysis: Foreman prompts the agent in the same
session to explain what failed, how to fix it, and how to prevent it, then stores the
answer on the task and writes a markdown lesson next to the project.

**Why this priority**: The owner asked for exactly this loop; it is high value but not
required to unblock a run.

**Independent Test**: On an error card run Analyse lesson; confirm the structured prompt is
sent, the three sections appear on the card, and a markdown file exists in the project.

**Acceptance Scenarios**:

1. **Given** an error card, **When** Analyse lesson runs, **Then** a fixed prompt asks for
   three labelled sections: what failed, fix, prevention.
2. **Given** the agent answers, **Then** the answer is parsed into `lesson.whatFailed`,
   `lesson.fix`, `lesson.prevention`; unparsable text is kept whole in `whatFailed` with a
   warning, never dropped.
3. **Given** a lesson is stored, **Then** a markdown file `docs/lessons/<date>-<slug>.md`
   is written in the task's project and `savedPath` records it.
4. **Given** the project directory is read-only or missing, **Then** the lesson stays in
   the store and the write failure is reported without losing the text.
5. **Given** a lesson exists, **Then** it is visible on the card detail and copied on
   request; the agent's transcript remains the source of truth.

---

### User Story 6 - Stop a run (Priority: Low)

The owner can interrupt a running task from its card and decide whether the card becomes
`stopped` (and can be restarted) or returns to Ready.

**Why this priority**: A stuck or wrong run wastes tokens; less frequent than approving.

**Independent Test**: Start a long run, press Stop, confirm the session is interrupted and
the card shows `stopped`.

**Acceptance Scenarios**:

1. **Given** a working card, **When** Stop is confirmed, **Then** the interrupt endpoint is
   called and the card shows `stopped` once the session reports interrupted.
2. **Given** an interrupt fails, **Then** the card keeps `working` and shows the error.
3. **Given** a stopped card, **When** the owner retries, **Then** a new prompt continues
   the same session.
4. **Given** a stopped card, **When** dropped on Ready, **Then** the same session is
   reused, not replaced.

### Edge Cases

- A permission request arrives for a session that is not linked to any task: it is ignored
  by the board (the app's own UI handles it).
- A request is approved in the app's normal UI: the board clears the badge without a
  duplicate reply.
- Two pending requests on one card: both are listed and may be answered independently.
- The reply endpoint returns 404 because the request expired: the card removes it and shows
  an informational note.
- The session disappears while a request is displayed: the card switches to `missing` and
  the answers are disabled.
- A form has an external field the board cannot render: the card offers "Open session" for
  that field and allows submitting the rest only if the server accepts it.
- The provider is rate limited: the error is classified as retryable with a suggested wait.
- The app closes while a lesson is being generated: on restart the card shows `unread`
  until the lesson text is read from the transcript.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST derive `action_required` when the task's session has at least
  one pending permission request or open form.
- **FR-002**: The system MUST derive `error` when the last execution failed, and MUST NOT
  derive `error` for an owner-initiated interrupt.
- **FR-003**: State precedence MUST be `action_required` → `error` → `working` → `unread` →
  `reviewed` → `missing`.
- **FR-004**: The system MUST refresh pending requests and forms within 5 seconds of a
  change, using server events where available and a bounded poll otherwise.
- **FR-005**: The card MUST show the request action, resources, source and message for a
  permission, and every field for a form.
- **FR-006**: The system MUST support permission replies `once`, `always` and `reject`
  with an optional message.
- **FR-007**: The system MUST validate form answers before submitting and MUST disable
  submit while required fields are empty.
- **FR-008**: The system MUST NOT answer a permission or form automatically, ever.
- **FR-009**: The system MUST store `lastError` on the task when a run fails and clear it
  when a new execution starts.
- **FR-010**: The system MUST offer Retry on error and stopped cards, sending a prompt to
  the existing session and never creating a new one.
- **FR-011**: The lesson flow MUST send one fixed, reviewable prompt to the existing
  session and MUST store a three-section lesson.
- **FR-012**: The system MUST write the lesson markdown into the project and MUST keep the
  lesson in the store if the write fails.
- **FR-013**: The system MUST support interrupting a run and MUST reflect the resulting
  `stopped` state.
- **FR-014**: The system MUST notify the owner when a card enters `action_required` and the
  board is not visible.
- **FR-015**: Every intervention MUST be attributable: the card records when and how it was
  answered, and the session transcript remains authoritative.

### Key Entities

- **Approval**: permission `id`, action, resources, save list, source, message, decision,
  answeredAt.
- **Question**: form `id`, title, fields, answers, answeredAt, cancelled flag.
- **Lesson**: `whatFailed`, `fix`, `prevention`, `savedPath`, `savedAt`.
- **Task** gains `lastError` and `lesson` (see `specs/001-board/data-model.md`).
- **RunState** gains `action_required`, `error`, `stopped` alongside P2's values.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A blocked card becomes visible within 5 seconds of the request, 10 out of 10
  trials.
- **SC-002**: Approving from the card resumes the run with zero duplicate replies.
- **SC-003**: 100% of failures show `error` with a non-empty message, never a raw payload
  alone.
- **SC-004**: The lesson flow produces three populated sections in 8 of 10 attempts; the
  remainder keep the raw answer without data loss.
- **SC-005**: Zero permissions or questions are answered without an explicit owner action.

## Assumptions

- The desktop app exposes the sidecar client capable of listing and replying to permission
  requests and forms.
- One task session blocks on at most a few requests at a time.
- Lessons are personal notes written as markdown in the project; ai-memory integration is
  an optional follow-up.
- English UI copy.
