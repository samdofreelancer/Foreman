# Tasks: Standalone Foreman Application

**Input**: Approved design documents from `specs/004-standalone-app/`

**Prerequisites**: `spec.md`, `plan.md`, `constitution-amendment.md`

**Constitution**: v2.0.0. Every phase MUST list the Articles it touches and MUST NOT
reintroduce plugin-host or plugin-GUI dependencies.

**Tests**: TDD for domain and application decisions; SQLite and OpenCode adapter
integration tests; Playwright E2E; security tests for the local HTTP boundary.

**Format**: `[ID] [P?] [US#] Description`

- `[P]` means independent work can proceed in parallel.
- `[US#]` maps to user stories in `spec.md`.

---

## Phase 0: Baseline and Architecture Guardrails

Articles: Product Identity, IV, VII, VIII.

- [x] T001 Record the current baseline: `npm test -- --run`, `npm run typecheck`, and
  `npm run build`; retain the results in the feature verification notes.
- [x] T002 [P] Add architecture-boundary tests/lint rules that prevent `domain/` from
  importing UI, server, SQLite, filesystem/process, or OpenCode modules.
- [x] T003 [P] Add a dependency-boundary test that rejects `@opencode/plugin/gui` imports
  from every target standalone entrypoint.
- [x] T004 Create an architecture decision record for the supported Node.js/OpenCode
  version matrix and validate the selected `@opencode/client` API against that runtime.
- [x] T005 Define the final package scripts and build outputs for `dev`, `build`, `start`,
  `test`, `typecheck`, and `test:e2e`; keep the plugin bundle build only while reference
  code remains.

**Checkpoint**: standalone architecture boundaries and current behaviour baseline are
documented before the plugin build is displaced. **Complete (2026-11-26)**: T001-T005
are checked off; OpenCode client 2.4.2 contract smoke tests passed. Managed-service
process ownership remains a dedicated Phase 3 integration gate and is not considered
verified by this checkpoint.

## Phase 1: Foundational Domain, Ports, and SQLite

Articles: II, III, IV, VI, IX.

- [x] T006 [P] Write domain tests for task/project/activity entities, validation,
  transitions, and immutable identifiers/timestamps.
- [x] T007 [P] Write failing concurrency tests proving one task cannot acquire two
  session ids and one session id cannot be assigned to multiple tasks.
- [x] T008 [P] Define application ports for TaskRepository, ProjectRepository,
  ActivityRepository, TransactionRunner, OpenCodeGateway, and SecretStore.
- [x] T009 Implement pure domain entities and decisions under `src/domain/`; remove
  dependence on plugin store types.
- [x] T010 Implement SQLite connection management, schema version ledger, and ordered
  transactional migrations under `src/adapters/persistence/sqlite/`.
- [x] T011 Implement TaskRepository with atomic create/update/delete and immutable
  `session_id` semantics; enforce a unique nullable session id at database level.
- [x] T012 Implement ProjectRepository and ActivityRepository with safe structured
  metadata and no transcript/secret fields.
- [x] T013 Implement database startup recovery: integrity check, migration failure state,
  read-only/degraded mode, and actionable UI-safe errors.
- [x] T014 Add repository integration tests against temporary SQLite files, including
  migration from an empty database, rollback, corruption, and concurrent session claims.

**Checkpoint**: domain and SQLite adapters pass tests without importing OpenCode or UI.
**Complete (2026-11-27)**: T006-T014 implemented and verified on Node.js 22.23.5 and
24.15.0. SQLite v1 migration, repositories, unique/immutable session linkage, safe
append-only activity metadata, transaction/migration rollback, corrupt/future-schema
handling, and read-only startup are covered by automated tests.

## Phase 2: Standalone Server and Local Security (US1, US5)

Articles: Product Identity, V, VII, X.

- [x] T015 [P] Write tests for loopback-only binding, occupied-port failure, Host/Origin
  rejection, CSRF validation, and disallowed cross-origin mutations.
- [x] T016 Implement the Fastify server bootstrap and same-origin API routing in
  `src/server/`; do not expose OpenCode endpoints or credentials to the browser.
- [x] T017 Implement explicit IPv4 loopback binding and IPv6 loopback support where
  available; fail closed if a non-loopback bind is requested.
- [x] T018 Implement Host/Origin validation, same-origin session handling, CSRF tokens,
  safe response headers, and restrictive CORS defaults.
- [x] T019 Implement static SPA serving, API error normalization, request validation,
  structured redacted logging, and graceful server shutdown.
- [x] T020 Implement CLI/application entrypoint that starts Foreman, reports the local
  URL, and opens the browser without requiring OpenCode Desktop.
- [x] T021 [P] Add security integration tests against the running HTTP server, including
  DNS-rebinding-style Host mismatch and browser-origin mutation attempts.

**Checkpoint**: Foreman launches independently and the HTTP service is loopback-only.
**Complete (2026-11-27)**: T015-T021 implemented and verified. Fastify binds IPv4 loopback
and IPv6 loopback when available; validates Host against the actual accepted socket port;
rejects cross-origin browser requests; requires an in-memory same-origin session and
timing-safe CSRF token for mutations; serves static assets and SPA routes; normalizes
errors and redacts request-sensitive log fields. The standalone CLI starts without any
OpenCode process, reports its local URL, optionally opens the browser, and closes both
listeners gracefully. HTTP integration tests cover DNS-rebinding-style Host mismatch,
cross-origin Origin rejection, CSRF, occupied ports, static fallback, and shutdown.

## Phase 3: OpenCode Adapter and Connection Lifecycle (US3, US5)

Articles: I, II, III, IV, V, VI, VIII.

- [x] T022 [P] Write OpenCodeGateway contract tests for health, project discovery,
  session create, prompt, follow-up, interrupt, permissions/forms, and session reads.
- [x] T023 [P] Write event-stream tests for disconnect, missed events, reconnect,
  resubscription, and mandatory session reconciliation.
- [x] T024 Implement the OpenCode HTTP client wrapper using `@opencode/client`; keep all
  imports and request mapping inside `src/adapters/opencode/`.
- [x] T025 Implement the managed-server process adapter using the documented
  `@opencode/client/service` lifecycle helpers and a Foreman-specific registration file;
  monitor health/exit and stop only the exact instance Foreman owns. If ownership cannot
  be guaranteed for the pinned runtime, use a directly spawned child process instead.
- [x] T026 Implement external-server mode with validated endpoint configuration; never
  stop or mutate the lifecycle of an externally managed server.
- [x] T027 Implement connection supervisor with startup timeout, health polling,
  disconnected/stale states, reconnect backoff, event resubscription, and authoritative
  resync of linked sessions.
- [x] T028 Implement OpenCode version/capability detection and explicit unsupported
  runtime reporting.
- [x] T029 Implement server-side secret handling through SecretStore; use an OS vault
  where available and process-session-only secrets otherwise.
- [x] T030 Add integration tests proving managed shutdown does not stop external servers,
  and unexpected process exit does not corrupt Foreman task data.

**Checkpoint**: both connection modes work through one adapter contract; disconnection
does not crash the app or present stale execution data as live.

**Implementation checkpoint (2026-11-27)**: T022-T030 are implemented. Managed
mode uses a directly spawned, loopback-only child process because the shared service
registration ownership contract is not accepted. External mode never stops its server.
The supervisor reconciles linked sessions on stream loss/reconnect and distinguishes
connected, stale, connecting, and disconnected states. Windows uses Credential Manager
with a process-memory fallback; non-Windows platforms currently use process-memory storage
pending Keychain/Secret Service adapters.

## Phase 4: User Story 1 — Launch and Use Foreman Independently

Articles: Product Identity, IV, V, VII, X.

- [x] T031 [P] Build the SolidJS application entry, router, design tokens, responsive
  application shell, and navigation layout under `src/ui/`.
- [x] T032 [P] Build first-run, loading, database-error, and disconnected application
  states with accessible status announcements.
- [x] T033 Wire server bootstrap, database initialization, and UI startup into a single
  local application lifecycle with graceful shutdown.
- [x] T034 Add Playwright tests for direct launch, refresh, browser restart, no OpenCode
  Desktop dependency, and narrow viewport navigation.

**Independent Test**: launch Foreman from its own command, open the Board route, refresh,
and verify the shell works while OpenCode is not running.

**Checkpoint (2026-11-27)**: T031-T034 implemented. SolidJS standalone client builds to
`dist/client`, with a dedicated Vite config and the old plugin-reference build moved to
`vite.plugin.config.ts`. The shell includes Board, Projects, Inbox, Activity and Settings
navigation, desktop sidebar, mobile drawer, local-service status, explicit OpenCode
disconnected state, loading/retry/database-degraded states, and responsive empty-state
surfaces. The CLI initializes Foreman's own SQLite database in the OS application-data
directory (or `FOREMAN_DATA_DIR`), reports readiness through `/api/health`, serves client
assets, and closes SQLite with its HTTP listeners. Playwright covers direct launch,
refresh/deep links, browser-context restart, offline runtime, database recovery UI,
mobile navigation, and horizontal overflow.

## Phase 5: User Story 2 — Task-Centric Board and Projects

Articles: I, III, IV, V, VI, VII, IX.

- [x] T035 [P] Port and adapt pure board grouping, ordering, filtering, search, and task
  transition tests to the standalone domain model.
- [x] T036 Implement task/project/activity API use cases and validated same-origin routes.
- [x] T037 Build Board, four columns, task cards, project filter, search, and meaningful
  empty/loading/error states in the standalone UI.
- [x] T038 Build task create/edit/detail surfaces; preserve project, agent/model, and
  task intent fields without exposing runtime-only controls on unlinked tasks.
- [ ] T039 Implement project discovery through OpenCode when connected plus local/manual
  project selection when disconnected.
- [x] T040 Implement Projects and Activity views backed only by Foreman-owned SQLite
  records; ensure activity entries are safe and do not contain transcript content.
- [x] T041 Implement task delete confirmation and status transitions; `doing` remains
  execution-controlled and moving to `ready` never starts a session.
- [x] T042 Add Playwright coverage for CRUD, filtering/search, multiple projects, task
  detail, reload persistence, keyboard accessibility, and 390px/1440px layouts.

**Independent Test**: create tasks across projects, filter/search, open details, reload,
and verify all local task data remains available with OpenCode disconnected.

**Implementation checkpoint (2026-11-27)**: T035-T038 and T040-T042 implemented and
verified. The standalone API exposes task CRUD/detail, local project listing/creation/
update, and recent/task activity through same-origin session+CSRF protected routes.
Creating a task auto-registers its project when needed. The Board renders four persisted
columns, project filter, title search, task cards, keyboard-openable detail, create/edit,
delete confirmation, and status controls. Projects and Activity are SQLite-backed.
Ready is a stored state only; it never starts an OpenCode session. Manual transitions into
or out of Doing are rejected because that column is runtime-controlled. T039's local/manual
project selection is implemented; live OpenCode project discovery is deferred until the
runtime connection can be configured through the Phase 8 settings surface. Phase 5 is
therefore functionally complete for disconnected task management, with connected project
discovery remaining an explicit integration follow-up.

## Phase 6: User Story 3 — Explicit OpenCode Execution

Articles: I, II, III, IV, V, VI, VII, VIII.

- [x] T043 [P] Write application-use-case tests for explicit start, double-submit,
  concurrent start, existing-session retry, follow-up, prompt failure, and disconnect.
- [x] T044 Implement StartTask use case: validate Ready state and healthy connection,
  claim task start atomically, create one session, persist its id before prompt send,
  then reconcile the resulting runtime state.
- [x] T045 Implement failure recovery when session creation succeeds but the initial
  prompt fails; preserve the session id and offer resend without new session creation.
- [x] T046 Implement follow-up use case targeting only the task's linked session; retries
  and follow-ups MUST NOT replace the session id.
- [x] T047 Implement event-to-domain mapping for execution started/succeeded/failed/
  interrupted, session idle, permission, form, and session deletion events.
- [x] T048 Implement task detail execution panel with live/stale/disconnected/failed/
  unknown distinctions and a route to the exact linked OpenCode session where supported.
- [x] T049 Add Playwright and adapter integration tests for 20 repeated start attempts,
  double-click, reload during run, event loss/reconnect, and prompt resend.

**Independent Test**: explicitly start one Ready task, verify one linked session and
initial prompt, disconnect/reconnect, then follow up in the same session.

**Implementation checkpoint (2026-11-27)**: T043-T049 implemented. The standalone CLI
now composes `TaskExecutionService` and `ForemanRuntimeController` with the Phase 3
OpenCode 2.4.x gateway/supervisor. Settings provides the minimum managed/external
connection controls needed for execution; full persisted connection settings and the
independent health surface remain Phase 8. The browser talks only to Foreman APIs.

Start is an explicit action on a Ready task. SQLite v2 adds `task_start_claims` and
`initial_prompt_state`; an atomic reservation is acquired before calling OpenCode, then
the session id is stored and the task enters Doing before the initial prompt is sent.
Session ids remain unique/immutable. A 20-way concurrent start test proves only one
session is created. A definitive 4xx session-creation rejection releases the reservation;
an ambiguous transport outcome retains it and blocks retries. The task detail view offers
a manual recovery action only after the user confirms they inspected OpenCode and no
session exists. A successful session create followed by prompt failure retains the session
and exposes Resend initial prompt against that same session. Follow-ups are queued into
the linked session and never create or replace sessions; following up a Done task reopens
it as Doing while the existing session resumes work.

The runtime supervisor is now connected to task reconciliation/event mapping. Execution
success moves the task to Done; failed/interrupted runs retain the linked session and
surface an error; missing/deleted sessions remain linked but are marked for attention.
Permission/form/idle events create safe activity metadata only—no prompt text, transcript,
permission payload, or credentials are persisted. Task detail distinguishes unknown,
failed, connected, stale, disconnected, and succeeded states, shows the exact session id,
and links to the OpenCode 2.x session route when the runtime exposes a server endpoint.

Full settings persistence, project auto-discovery, Inbox aggregation/response controls,
and native Keychain/Secret Service storage remain outside this phase.

## Phase 7: User Story 4 — Inbox and Human Attention

Articles: I, II, III, IV, V, VI, VII, VIII.

- [ ] T050 [P] Write tests for deriving attention items from supported OpenCode
  permissions, questions/forms, errors, and stale/missing sessions.
- [ ] T051 Implement Inbox query/use case that aggregates actionable states by task and
  links each item to its task context.
- [ ] T052 Build Inbox view with distinct permission/question/error states, readable
  reasons, counts, empty state, and navigation to the relevant task.
- [ ] T053 Ensure resolving an item in OpenCode clears the Foreman Inbox after event
  update or reconnect reconciliation; do not auto-approve or auto-answer.
- [ ] T054 Add integration/E2E coverage for multiple attention items, externally resolved
  requests, errors, empty Inbox, and disconnected runtime.

**Independent Test**: create supported attention states on linked sessions and verify
they appear in Inbox without any action being taken on the owner's behalf.

## Phase 8: User Story 5 — Connection and Application Health

Articles: I, IV, V, VII, VIII, X.

- [ ] T055 Build connection settings for managed/external mode, endpoint validation,
  connect/disconnect, and clear process/connection health status.
- [ ] T056 Build application health surface for server, SQLite, and OpenCode runtime
  independently; distinguish app health from execution state.
- [ ] T057 Add tests for invalid endpoint, wrong OpenCode version, stopped managed child,
  external server loss, reconnect, and unavailable local database.

**Independent Test**: launch with no runtime, connect, disconnect, and reconnect while
the Board remains usable and runtime state is labelled accurately.

## Phase 9: Backup, Restore, and Data Safety

Articles: V, VI, VII, IX, X.

- [ ] T058 [P] Write backup/restore tests for valid archive, invalid manifest, schema
  mismatch, corrupt database, secret exclusion, and rollback after failed restore.
- [ ] T059 Implement user-triggered SQLite backup with manifest, schema version, and
  integrity verification; exclude credentials, provider secrets, and transcripts.
- [ ] T060 Implement restore preview and confirmation; stop writes, validate staged DB,
  atomically replace active DB, and retain a rollback copy.
- [ ] T061 Add UI for backup, restore, progress, success/failure, and clear warning that
  restore replaces current Foreman task data.

**Checkpoint**: backup works with OpenCode offline; restore is safe and reversible.

## Phase 10: Security, Regression, and Plugin Decommissioning

Articles: I–X, with release gates on II, III, IV, VII, VIII, IX, X.

- [ ] T062 Run full automated unit, integration, security, and Playwright suites; fix all
  regressions and record the exact supported Node/OpenCode versions.
- [ ] T063 Perform a security review of loopback binding, Host/Origin checks, CSRF,
  browser storage, logs, exports, filesystem paths, and process arguments.
- [ ] T064 Verify 1440px and 390px UI acceptance, keyboard paths, screen-reader labels,
  empty/loading/error states, and no page-level horizontal overflow.
- [ ] T065 Remove plugin entrypoints, `src/gui*`, plugin-specific stores, GUI API imports,
  plugin build configuration, and `@opencode/plugin` dependency after standalone parity
  and all acceptance tests pass.
- [ ] T066 Update README and quickstart for standalone install/run/build/test, managed and
  external OpenCode modes, SQLite location, backup/restore, security boundary, and known
  compatibility limits.
- [ ] T067 Verify a clean install from the lockfile, first-run database creation,
  standalone launch, managed/external connection, backup/restore, and graceful shutdown.
- [ ] T068 Confirm no plugin data migration path or plugin runtime dependency remains in
  the shipped product; record final verification and release checklist.

## Dependencies

- Phase 0 blocks all implementation phases.
- Phase 1 blocks server, OpenCode adapter, and all user stories.
- Phase 2 and Phase 3 can proceed in parallel after Phase 1; US1 needs Phase 2, US3/US5
  need Phase 3.
- US1 shell is the UI foundation for US2–US5.
- US2 task persistence and detail surfaces block US3 and US4.
- US3 execution state and event mapping block US4 attention aggregation.
- Phase 9 can proceed after Phase 1 and is independent of OpenCode availability.
- Phase 10 starts only after all user stories and backup/restore are complete.

## Parallel Opportunities

- T006–T008 are independent design/test tasks.
- T015 security tests and T022–T023 OpenCode adapter tests can be prepared in parallel
  after the ports are agreed.
- T031 and T032 are independent UI foundation components.
- T035 board-domain tests and T036 API use cases can proceed in parallel once domain
  contracts are stable.
- T050 attention derivation tests can be written while US3 event mapping is implemented.
- T058 backup tests can be developed independently of the UI.

## MVP / Delivery Milestones

1. **Standalone shell**: Phases 0–4. Foreman launches independently and safely.
2. **Task manager**: Phase 5. Board and projects persist in SQLite.
3. **Execution control plane**: Phase 6. Explicit start/follow-up with one session per task.
4. **Operational awareness**: Phases 7–8. Inbox and connection health.
5. **Release-ready**: Phases 9–10. Backup/restore, security verification, plugin removal.

Do not remove the existing plugin reference implementation before milestone 5's parity
and regression gates are satisfied.
