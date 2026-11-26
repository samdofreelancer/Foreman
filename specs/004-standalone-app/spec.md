# Feature Specification: Standalone Foreman Application

**Feature Branch**: `004-standalone-app`  
**Created**: 2026-11-26  
**Status**: Approved
**Input**: User direction: "Foreman is currently an OpenCode plugin with features 001 and 002 implemented. Reposition it as an external standalone application with a modern, task-centric UI. Write the SpecKit specification before implementation."

## Product Positioning

Foreman is a standalone, task-centric control plane for OpenCode.

Developers manage work in Foreman. Foreman manages task state, execution visibility,
and human intervention. OpenCode remains the agent execution runtime. Foreman is not a
replacement coding agent, a general-purpose multi-agent framework, or an OpenCode UI clone.

**Product promise**: one place to create, start, monitor, review, and intervene in work
performed by OpenCode agents — without managing a collection of OpenCode chat sessions.

## Existing Capabilities to Preserve

The repository already contains the following capabilities. This feature changes their
product surface and integration boundary; it does not redefine or discard them.

- **Feature 001 — Board and Task Store**: task CRUD, project association, four task
  columns (`todo`, `ready`, `doing`, `done`), filtering, search, and persisted task data.
- **Feature 002 — Run the Task**: starting an OpenCode session for a task, sending the
  initial prompt, deriving run state from session data, opening the linked session, sending
  follow-ups, and completing a task.
- **Task/session invariant**: one task owns at most one OpenCode session. Follow-ups and
  retries continue in that session; a task must not silently switch to another session.
- **Human authority**: starting a run or sending a prompt is an explicit user action.
  Foreman must not silently execute work in the background.

The current plugin implementation is the behavioural reference when re-hosting the
existing capabilities. Its stored task data is not migrated. The standalone application
must not assume that the existing README or task checkboxes are an accurate
implementation-status record; source code and executable tests are authoritative.

## User Scenarios & Testing

### User Story 1 — Open Foreman independently of OpenCode (Priority: High)

As a developer, I can launch Foreman as its own application and use its workspace without
opening the OpenCode plugin/settings surface. Foreman presents its own application shell,
navigation, responsive layout, and task-centric workspace.

**Why this priority**: standalone ownership is the defining product change. If users still
need to open a plugin page to use Foreman, the product has not been separated from OpenCode.

**Independent Test**: launch Foreman directly, open the Board, navigate to a task, refresh
the application, and confirm the application remains usable without rendering inside
OpenCode Desktop.

**Acceptance Scenarios**:

1. **Given** Foreman is installed and configured, **When** the user launches it, **Then**
   Foreman opens in its own application surface with its own navigation and workspace.
2. **Given** OpenCode Desktop is not the foreground application, **When** the user opens
   Foreman, **Then** the Board and locally stored task information remain accessible.
3. **Given** the application is opened at a narrow viewport, **When** the user navigates
   the workspace, **Then** the interface reflows without page-level horizontal overflow
   or clipped primary actions.
4. **Given** the OpenCode connection is unavailable, **When** Foreman starts, **Then** the
   application shell and saved tasks still render with a clear disconnected state.

### User Story 2 — Manage work from a task-centric workspace (Priority: High)

As a developer, I can understand and manage work by Task rather than by OpenCode Session.
The Board is the primary workspace. A task detail surface brings together intent,
project, execution state, linked session, and recent activity.

**Why this priority**: Task is the user's unit of work. Sessions are implementation
details and must not dominate the information architecture.

**Independent Test**: create tasks in multiple projects, filter and search them, open a
task detail view, and verify its description, status, project, and linked session are
visible without navigating to a session list.

**Acceptance Scenarios**:

1. **Given** tasks exist across projects, **When** the user opens Board, **Then** tasks
   appear in Todo, Ready, Doing, and Done with project identity and meaningful run status.
2. **Given** a task card is selected, **When** its detail surface opens, **Then** the
   user sees task intent, project, execution state, checklist/progress where available,
   linked OpenCode session, and task activity in one context.
3. **Given** a task has a linked session, **When** the user chooses to inspect the raw
   conversation, **Then** Foreman opens or focuses that exact OpenCode session.
4. **Given** a task has no session, **When** its detail is opened, **Then** session-only
   controls are absent or clearly disabled; no session is created merely by viewing it.
5. **Given** the user searches or filters tasks, **When** results change, **Then** task
   cards, column counts, and empty states remain consistent.

### User Story 3 — Start and follow OpenCode execution from Foreman (Priority: High)

As a developer, I can mark a task Ready and then explicitly start it from its task
context. Foreman creates one linked OpenCode session, sends the task prompt, and tracks
the resulting execution. I can see whether the agent is working, idle/unread, reviewed,
missing, or disconnected.

**Why this priority**: this preserves the value of Feature 002 and makes the standalone
application more than a static task tracker.

**Independent Test**: connect Foreman to an OpenCode runtime, start one task, verify one
session is created with the correct project and prompt, then verify state updates and
follow-up delivery target that same session.

**Acceptance Scenarios**:

1. **Given** a task is moved to Ready, **When** the status changes, **Then** no OpenCode
   session is created and no prompt is sent.
2. **Given** a valid Ready task and a healthy OpenCode connection, **When** the user
   explicitly chooses Start from the task context, **Then** Foreman creates exactly one
   session in the task's project and sends the task description as the initial prompt.
3. **Given** a task already has a session id, **When** the user attempts to start it
   again, **Then** Foreman does not create a second session and instead offers the valid
   continuation/retry action for the existing session.
4. **Given** a session is running, **When** OpenCode reports session activity, **Then**
   Foreman updates the task's execution state without requiring a manual page refresh.
5. **Given** the user sends a follow-up from task detail, **When** it is submitted,
   **Then** the message is delivered to the task's existing session.
6. **Given** the OpenCode connection drops during a run, **When** Foreman loses live
   updates, **Then** the task and session association are retained and the UI indicates
   that execution state may be stale.
7. **Given** session creation succeeds but the initial prompt fails, **When** Foreman
   handles the failure, **Then** it persists the created session id and offers to resend
   the prompt without creating another session.

### User Story 4 — Know what needs human attention (Priority: High)

As a developer, I can find tasks that need my attention without inspecting every
OpenCode session. Foreman provides an Inbox/attention view for pending approvals,
questions, failures, and other actionable states supported by the connected runtime.

**Why this priority**: the control plane must make intervention visible and keep human
authority explicit. This story defines the product surface; detailed intervention
behaviour remains governed by Feature 003 and its implementation status.

**Independent Test**: with a linked session in a supported attention state, verify the
task appears in the attention view, the reason is understandable, and no action is taken
until the user explicitly chooses it.

**Acceptance Scenarios**:

1. **Given** a linked session has a supported pending permission or question, **When**
   Foreman receives the corresponding state, **Then** the task is surfaced in Inbox with
   the reason and a route to the relevant intervention.
2. **Given** a task execution fails, **When** the failure is detected, **Then** the task
   shows an error state and a human-readable reason, not an unexplained idle state.
3. **Given** an attention item is resolved in OpenCode itself, **When** Foreman receives
   the updated runtime state, **Then** the stale attention item clears.
4. **Given** multiple tasks need attention, **When** the user opens Inbox, **Then** items
   can be distinguished and opened in their task context.
5. **Given** no tasks need attention, **When** Inbox opens, **Then** it shows a useful
   empty state rather than an empty generic table.

### User Story 5 — Understand connection and application health (Priority: Medium)

As a developer, I can see whether Foreman is connected to OpenCode and whether the
connection is healthy, so I can distinguish a stopped agent from a disconnected runtime.

**Independent Test**: launch Foreman with no OpenCode server, connect to a valid server,
disconnect it, and reconnect; verify the status and task states are correctly reconciled.

**Acceptance Scenarios**:

1. **Given** no OpenCode runtime is configured, **When** the user opens Foreman, **Then**
   the UI offers a clear connection/setup path and keeps non-runtime features available.
2. **Given** a runtime is connected, **When** its health changes, **Then** the connection
   indicator updates and stale session state is not presented as live.
3. **Given** the configured endpoint is invalid or unavailable, **When** connection
   fails, **Then** the error is actionable and does not crash the application.

## UX and Interaction Requirements

- The application shell MUST be owned by Foreman, not rendered inside OpenCode Desktop.
- The primary navigation MUST be task-oriented. The initial information architecture
  includes **Board**, **Inbox**, **Projects**, and **Activity**; connection/settings
  controls are secondary navigation.
- **Board** is the default landing workspace. The initial workflow retains Todo, Ready,
  Doing, and Done. The board MUST support project filtering and task search.
- Selecting a task MUST open a task detail surface (side panel or dedicated detail route)
  without losing the user's board context.
- Task detail MUST treat the task as the primary entity and show the OpenCode session as
  a linked execution resource, not as the primary navigation object.
- The UI MUST expose execution status, last activity, project, agent/model when known,
  and a direct action to open the linked session in OpenCode.
- The UI MUST distinguish live, stale, disconnected, failed, and unknown runtime states.
- The design MUST use readable typography, consistent spacing, clear status hierarchy,
  keyboard-accessible controls, and responsive layouts for desktop and narrow screens.
- The UI MUST NOT require horizontal scrolling of the whole application page. If a
  multi-column board needs horizontal scrolling at constrained widths, navigation and
  task detail remain usable and no primary action may be clipped.
- Live activity MUST be useful but subordinate to the Board; it MUST be collapsible or
  independently navigable rather than permanently consuming a large fixed portion of
  the task workspace.
- Empty, loading, disconnected, and error states MUST be designed as first-class states.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST run as a standalone application with its own application
  shell and navigation, independently of the OpenCode Desktop plugin UI.
- **FR-002**: The system MUST retain the task lifecycle and CRUD capabilities defined by
  Feature 001.
- **FR-003**: The system MUST retain the OpenCode task execution capabilities defined by
  Feature 002, including session creation, initial prompt, live state, session opening,
  follow-up, and completion semantics.
- **FR-004**: A task MUST remain the primary work entity; a linked OpenCode session MUST
  be represented as an execution resource belonging to that task.
- **FR-005**: The system MUST preserve the invariant that one task owns at most one
  OpenCode session id. A retry or follow-up MUST NOT silently create or adopt another
  session.
- **FR-006**: The system MUST connect to OpenCode through a supported client/API/runtime
  integration boundary. The standalone application MUST NOT depend on the experimental
  OpenCode GUI plugin API to render or operate its primary UI.
- **FR-007**: The system MUST observe runtime state through supported OpenCode APIs and
  events, and MUST reconcile state after reconnect or missed events.
- **FR-008**: The system MUST NOT read or write OpenCode's internal database directly.
  OpenCode-owned state changes MUST go through supported runtime interfaces.
- **FR-009**: Every operation that creates a session, sends a prompt/follow-up, retries,
  interrupts a run, or answers a permission/question MUST be initiated by an explicit
  user action. Moving a task to Ready MUST NOT start execution. No autonomous dispatcher
  or implicit execution is introduced by this feature.
- **FR-010**: The system MUST retain usable task data and the application shell when the
  OpenCode runtime is disconnected or unavailable.
- **FR-011**: The system MUST distinguish runtime connection health from task execution
  state so that a disconnected session is not shown as definitely stopped or completed.
- **FR-012**: The system MUST provide the task-centric navigation and detail behaviours
  described in the UX and Interaction Requirements.
- **FR-013**: The system MUST support the four existing task columns and preserve the
  semantics that `doing` is controlled by execution state, not an arbitrary manual edit.
- **FR-014**: The system MUST provide a visible route from a task to its exact linked
  OpenCode session when the runtime supports opening that session externally.
- **FR-015**: The system MUST make connection configuration and failures understandable
  without exposing credentials or sensitive connection material in the UI or logs.
- **FR-016**: The system MUST document compatibility with supported OpenCode runtime
  versions and report unsupported capabilities explicitly.
- **FR-017**: The system MUST support both OpenCode connection modes: (a) Foreman-managed
  lifecycle, where Foreman starts and supervises its own `opencode serve` process, and
  (b) external-server mode, where Foreman connects to an OpenCode server started and
  managed by the user. The user MUST be able to select/configure the mode, and Foreman
  MUST report process/connection health accurately for each mode.
- **FR-018**: The standalone application MUST use a new, dedicated local SQLite database
  as the source of truth for Foreman-owned tasks, projects, and activity records. It MUST
  NOT read, import, or depend on the existing plugin's task store. OpenCode remains the
  source of truth for session transcripts and runtime execution state.
- **FR-019**: The application MUST provide an explicit user-initiated backup/export and
  restore/import path for its SQLite-backed Foreman data. Backup operations MUST NOT
  require OpenCode to be running and MUST NOT include OpenCode credentials, provider
  secrets, or session transcripts.

### Security and Privacy Requirements

- **SEC-001**: The initial release MUST bind the Foreman web server to loopback
  interfaces only (`localhost` / `127.0.0.1` and the equivalent IPv6 loopback where
  supported). It MUST NOT listen on LAN, Tailscale, or public network interfaces.
  Remote access is out of scope for this release and requires a separate security design
  and explicit approval before implementation.
- **SEC-002**: Credentials or tokens used to connect to OpenCode MUST NOT be stored in
  task descriptions, exported task data, browser-visible logs, or plaintext diagnostic
  output.
- **SEC-003**: The local service MUST validate the request Host and Origin, reject
  untrusted cross-origin requests, and protect state-changing browser requests against
  CSRF/DNS-rebinding-style access. It MUST NOT expose an unauthenticated, remotely
  reachable control endpoint by default.
- **SEC-004**: Destructive or execution-affecting actions MUST require an explicit user
  gesture and clear action semantics.
- **SEC-005**: Task export files MUST be treated as user data and MUST NOT include
  OpenCode credentials, provider secrets, or unrelated session transcripts.

### Key Entities

- **Task**: the existing task entity from Feature 001, retaining stable id and fields.
- **Execution**: the OpenCode execution reference associated with a task; initially
  constrained to at most one session id per task.
- **OpenCode Connection**: configured runtime endpoint and connection health/capabilities;
  secrets are stored separately from ordinary application data.
- **Activity Event**: a user-visible event associated with a task or application, such
  as task changes, session lifecycle changes, and user interventions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can launch Foreman and reach the Board without opening OpenCode
  Desktop or its plugin/settings UI.
- **SC-002**: All supported Feature 001 and Feature 002 acceptance scenarios pass against
  the standalone application, with no regression in task/session invariants.
- **SC-003**: With the OpenCode runtime disconnected, the Board and saved task detail
  remain usable and clearly mark execution data as unavailable or stale.
- **SC-004**: At a 1440px desktop viewport, the Board, task detail, and primary navigation
  are usable without page-level horizontal overflow.
- **SC-005**: At a 390px narrow viewport, users can reach Board, Inbox, and task actions
  without clipped controls or forced desktop-width layouts.
- **SC-006**: In 20 repeated start attempts, each task creates at most one OpenCode
  session, including double-clicks, retries, reconnects, and repeated UI submissions.
- **SC-007**: No session creation, prompt, approval, question answer, or interrupt occurs
  without a corresponding explicit user action.

## Scope Boundaries

### In Scope

- Standalone Foreman application shell and task-centric UI.
- Re-hosting Feature 001 and Feature 002 capabilities outside OpenCode Desktop.
- A supported OpenCode runtime integration adapter and connection-health experience.
- Responsive Board, task detail, Inbox/attention entry point, Projects, and Activity.
- Single-user local-first operation with one local Foreman data store.

### Out of Scope

- Replacing or forking the OpenCode agent runtime.
- General-purpose support for Hermes, Claude Code, Codex, or arbitrary agent runtimes.
- Multi-user collaboration, hosted SaaS, organization/team tenancy, and cloud sync.
- Autonomous task dispatch, scheduled execution, approval policies, or automatic retries.
- Multi-agent orchestration, parallel agents per task, worktree-per-task management.
- Direct access to or modification of OpenCode's internal database.
- Reimplementing the full OpenCode chat/transcript UI.
- Requiring the OpenCode plugin to remain installed for normal standalone operation.

## Constitution Impact

The plugin-oriented Constitution v1.0.0 has been superseded by the standalone
application Constitution v2.0.0. The amendment is recorded in
`constitution-amendment.md` and the governing rules are in
`.specify/memory/constitution.md`. Feature 004 MUST comply with v2.0.0; plugin GUI
architecture and plugin-host lifecycle are not valid implementation assumptions.

## Assumptions

- Foreman remains OpenCode-first; other runtimes are not part of this feature.
- The first release is intended for one local user and one or more local OpenCode projects.
- OpenCode exposes a supported server/API/client interface that can be used outside its
  GUI plugin runtime; exact supported versions and connection lifecycle require technical
  validation during planning.
- The standalone application owns its task persistence. OpenCode remains authoritative
  for session transcripts and runtime execution state.
- The standalone app starts with a new, empty SQLite database. Existing plugin task data
  is intentionally not migrated; the app does not read or depend on the plugin store.
- The OpenCode plugin is not part of the target product architecture and is not retained
  as a compatibility layer, migration bridge, or runtime dependency.
- Feature 003 (Intervene) is a separate capability specification. This feature defines
  the standalone Inbox and intervention entry point but does not claim that every
  Feature 003 interaction is already implemented.
- UI language remains English-first unless the owner changes that decision.

## Resolved Product Decisions

1. **Application form factor — RESOLVED**: The first standalone release is a local web
   app opened in the browser. Electron/Tauri packaging is not part of the initial release.
2. **OpenCode runtime lifecycle — RESOLVED**: Foreman MUST support both modes:
   - **Managed mode**: Foreman starts, monitors, and stops its own `opencode serve`
     process as part of the application lifecycle.
   - **External-server mode**: Foreman connects to an OpenCode server that the user
     started and manages independently.
   The user can choose the mode through connection settings. The implementation must
   handle startup failures, unexpected process exit, server unavailability, and clean
   shutdown without losing task data or creating duplicate sessions.
3. **Persistence and backup — RESOLVED**: The standalone application uses a local SQLite
   database as the source of truth for Foreman-owned tasks, projects, and activity.
   OpenCode remains authoritative for session transcripts and runtime execution state.
   Backup/export and restore/import are explicit user-initiated operations, independent
   of OpenCode availability; backup packages exclude credentials, provider secrets, and
   session transcripts.
4. **Plugin transition — RESOLVED**: Remove the existing OpenCode plugin from the target
   product. Do not build a migration bridge or import workflow. The standalone app starts
   with a new SQLite database; existing plugin tasks/projects/session links are not
   migrated. The app must not read or depend on the plugin's local data store.
5. **Distribution/network boundary — RESOLVED**: The first release is localhost-only.
   Bind to loopback interfaces; do not expose the service over LAN, Tailscale, or public
   network interfaces. Any remote-access capability requires a separate security design
   and explicit approval.

All product clarifications are resolved. The constitution amendment has been applied and
recorded. The owner approved the standalone product direction and Constitution v2.0.0 on
2026-11-26. Feature 004 is approved as the input to implementation planning.
