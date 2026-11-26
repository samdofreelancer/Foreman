# Foreman Constitution

**Version**: 2.0.0 | **Ratified**: 2026-11-26 | **Last amended**: 2026-11-26

These rules are non-negotiable for every phase of Foreman. A plan that violates one is
rejected before implementation, and a task that does so is not merged.

## Product identity

Foreman is a standalone, local-first web application for managing work executed by
OpenCode. It is not an OpenCode plugin, GUI extension, embedded panel, or plugin-hosted
application. The browser UI and application lifecycle are owned by Foreman. OpenCode is
an external execution runtime integrated through its supported server/client interfaces.

The first release uses a local SQLite database and binds its web server to loopback
interfaces only. Remote access, hosted deployment, and other agent runtimes require
separate specifications and explicit approval.

## Article I — The owner decides

Every action that creates a session, sends a prompt or follow-up, retries a run,
approves a permission, answers a question, interrupts execution, or deletes a task MUST
originate from an explicit owner gesture in the Foreman UI. Foreman never acts on a
schedule, on a rule, or on the model's behalf.

A retry or follow-up is still an owner gesture: the owner presses a button, and the
button names exactly what it will send or do. Merely moving a task to Ready MUST NOT
implicitly start execution.

## Article II — Never access OpenCode's internal database

Foreman interacts with OpenCode only through supported client, server API, and event
interfaces. Direct SQL against `opencode.db`, filesystem edits to it, or any out-of-band
mutation of OpenCode-owned state are forbidden.

Foreman owns its own SQLite database for tasks, projects, configuration metadata, and
activity records. OpenCode remains authoritative for session transcripts and runtime
execution state. These stores MUST NOT be conflated or accessed through undocumented
storage internals.

## Article III — One task, one session

A task owns at most one OpenCode session id, set when the run starts and never silently
replaced. Follow-ups and retries reuse that session. A task MUST NOT silently adopt a
different session, including a subagent session identified by a `parentID`.

## Article IV — Pure domain, explicit application boundaries

Business rules and decisions live in `src/domain/` as pure functions with unit tests.
They MUST NOT depend on browser APIs, UI frameworks, process management, persistence
drivers, or OpenCode clients.

Application and UI layers translate user intent into application use cases and present
their results. Infrastructure effects are implemented behind explicit ports/adapters:

- The OpenCode adapter is the only boundary allowed to call supported OpenCode APIs,
  manage an `opencode serve` process, or consume OpenCode runtime events.
- The persistence adapter is the only boundary allowed to access Foreman's SQLite
  database.
- Process lifecycle, filesystem access, secrets, and external integrations MUST remain
  outside the domain layer.

No domain rule may call an adapter directly. Application use cases orchestrate domain
decisions and adapters while preserving owner-initiated action semantics.

## Article V — Degrade, never crash

A corrupt or unavailable local store, missing project directory, expired permission
request, deleted session, stopped OpenCode process, unreachable server, or read-only
project MUST render as a visible, recoverable state. The application shell and locally
persisted task data remain usable when OpenCode is unavailable. A runtime outage MUST
NOT be misrepresented as a stopped or completed execution.

## Article VI — Respect data ownership and authority

Foreman is authoritative for task intent, project metadata, user-managed task state,
application configuration, and its own activity history. OpenCode is authoritative for
session transcripts and live execution state. Foreman may persist a session reference
and derived snapshots needed for display/recovery, but MUST reconcile runtime state with
OpenCode and MUST identify stale or unavailable observations as such.

When Foreman and OpenCode disagree about a session's actual runtime state, OpenCode's
current supported runtime state wins. This does not override Foreman's ownership of task
intent or task metadata.

## Article VII — Test decisions and verify the application

Domain logic ships with tests written first. Application use cases and adapters have
automated tests, including failure and reconnect paths. UI behaviour is verified against
the running standalone web application at desktop and narrow viewports. OpenCode
integration is verified against supported OpenCode server/runtime versions; verification
MUST NOT require rendering Foreman inside OpenCode Desktop.

No feature is complete because it compiled. Relevant tests, runtime verification, and
known limitations are recorded with the change.

## Article VIII — Isolate the OpenCode integration

All OpenCode client/API imports, event subscriptions, process lifecycle operations, and
runtime-specific compatibility logic MUST live behind the OpenCode adapter boundary.
No plugin GUI API, including `@opencode/plugin/gui`, may be used by the standalone app.
An OpenCode upgrade MUST be absorbed by the adapter and its compatibility tests, not
spread through the domain, application use cases, or UI.

## Article IX — Local-first persistence and recoverability

SQLite is the source of truth for Foreman-owned persistent data in the initial release.
Database schema changes MUST be versioned and migrated safely. User-initiated backup and
restore MUST be supported, and backup MUST remain possible while OpenCode is offline.
Backups MUST exclude OpenCode credentials, provider secrets, and session transcripts.
The application MUST NOT depend on the former plugin's store or migrate its records.

## Article X — Secure local boundary

The initial release MUST bind only to loopback interfaces. It MUST NOT expose its
control API to LAN, Tailscale, or public interfaces. Browser-origin protections and
request validation MUST prevent untrusted websites from using the local service as a
confused deputy. Secrets MUST be stored separately from ordinary task data and MUST NOT
appear in browser-visible logs, exports, or diagnostic output.

Execution-affecting and destructive actions require explicit user intent and clear
semantics. Any future remote-access mode requires a separate threat model, security
specification, and owner approval before implementation.

## Governance

- Amendments require an owner-approved change to this file, a version bump, and the
  rationale recorded in `specs/`.
- The plan of each phase lists which articles it touches and how it complies.
- Breaking Article I, II, III, or X halts the phase, regardless of schedule.
- This constitution supersedes the plugin-oriented Constitution v1.0.0. Plugin GUI
  architecture and plugin-host lifecycle are no longer valid product assumptions.
