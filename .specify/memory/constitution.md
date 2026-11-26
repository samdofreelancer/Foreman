# Foreman Constitution

**Version**: 1.0.0 | **Ratified**: 2026-11-25 | **Last amended**: 2026-11-25

These rules are non-negotiable for every phase of Foreman. A plan that violates one is
rejected before implementation, and a task that does so is not merged.

## Article I — The owner decides

Every action that creates a session, sends a prompt, approves a permission, answers a
question, interrupts a run, or deletes a task MUST originate from an explicit owner
gesture in the UI. Foreman never acts on a schedule, on a rule, or on the model's behalf.

A retry, follow-up, or lesson analysis is still an owner gesture: the owner presses a
button, and the button names exactly what it will send.

## Article II — Never touch the database

Foreman reads and writes OpenCode state only through the app's client, its server events,
and its own plugin store. Direct SQL against `opencode.db`, filesystem edits to it, or any
out-of-band state change is forbidden.

## Article III — One task, one session

A task owns at most one session id, set once when the run starts and never replaced.
Follow-ups, retries, and lesson analysis reuse it. A task never adopts a session that has a
`parentID` (a subagent).

## Article IV — Decisions are pure, effects are thin

Every rule that decides what to show or what may happen lives in `src/domain/` as a pure
function with unit tests. `src/gui/` only translates a decision into one host call and
reconciles the result. A pure function never calls a client.

This is what makes the dangerous paths — starting runs and answering prompts — impossible
to reach accidentally.

## Article V — Degrade, never crash

A corrupt store, a missing project directory, an expired permission request, a deleted
session, an unreachable sidecar, or a read-only project MUST render as a visible,
recoverable state. The board never shows a blank screen and never throws into the host.

## Article VI — The transcript is authoritative

Foreman stores only what the app cannot derive: task intent, the session id, the last
error line, and the lesson. Run state is always derived from live session data. When the
store and the session disagree, the session wins, and the card says so.

## Article VII — Test the decisions, verify the surfaces

Domain logic ships with tests written first. GUI behaviour is verified against a running
OpenCode Desktop and the result recorded with the commit; no feature is "done" because it
compiled.

## Article VIII — Isolate the experimental API

Every import of `@opencode/plugin/gui` and every host call lives under `src/gui/`. An
OpenCode upgrade that changes the experimental surface must be absorbed there, not spread
through the domain.

## Governance

- Amendments require an owner-approved change to this file, a version bump, and the
  rationale recorded in `specs/`.
- The plan of each phase lists which articles it touches and how it complies.
- Breaking Article I or II halts the phase, regardless of schedule.
