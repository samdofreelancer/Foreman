# Implementation Plan: Standalone Foreman Application

**Planned Branch**: `004-standalone-app` (not created) | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Approved feature specification from `specs/004-standalone-app/spec.md`

## Summary

Re-host Foreman's task-centric workflow as an independently launched local web
application. The target product owns its Node.js application lifecycle, browser UI,
SQLite persistence, and local security boundary. OpenCode remains an external execution
runtime accessed through its supported HTTP client and server events. The existing
plugin source is retained temporarily as a behavioural reference while the standalone
replacement is built and verified; it is not shipped, loaded, or required by the target
application. Once parity and regression checks pass, plugin entrypoints and dependencies
are removed.

No plugin data migration is implemented. A first launch creates a new Foreman SQLite
database. Feature 001 and Feature 002 behaviour is re-hosted, not copied wholesale from
the plugin architecture.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22/24 LTS, SolidJS 1.9, Vite 7

**Primary Dependencies**:
- `@opencode/client` for the supported OpenCode HTTP API and typed event stream.
- Fastify for the local application HTTP server and API boundary.
- `better-sqlite3` for local SQLite persistence and transactional repositories.
- SolidJS and Vite for the standalone browser UI.
- Vitest for unit/integration tests; Playwright for browser acceptance tests.

Exact package versions are pinned in the lockfile. OpenCode compatibility is tested
against an explicitly supported runtime version range; the adapter reports unsupported
versions/capabilities rather than guessing.

**Storage**: A new SQLite database owned exclusively by Foreman. Versioned migrations
create Task, Project, Activity Event, and application configuration records. A nullable,
unique `session_id` on Task enforces at most one linked session per task and prevents a
session from being silently assigned to multiple tasks. OpenCode transcripts and live
execution state are never copied into SQLite.

**Testing**:
- Vitest unit tests for pure domain decisions and application use cases, written first.
- SQLite repository and migration integration tests using temporary database files.
- OpenCode adapter contract tests using a controllable HTTP/SSE test server.
- Playwright E2E for standalone launch, Board CRUD, responsive layouts, connection
  failure/recovery, and owner-initiated execution.
- Security tests for loopback binding, Host/Origin validation, CSRF protection, and
  secret redaction.

**Target Platform**: Local desktop environments with Node.js 22 or 24 LTS and OpenCode
2.4.x runtime installed. The first release binds to loopback only and opens in a regular
browser. See ADR-0001 for the verified compatibility baseline.

**Project Type**: Single repository, one local Node.js application serving a SolidJS SPA
and a same-origin JSON API. The browser never connects directly to OpenCode; the server
owns the OpenCode client, process lifecycle, and credentials.

**Performance Goals**:
- Cold start to usable Board within 3 seconds on the reference development machine,
  excluding OpenCode runtime startup.
- Local task CRUD responds within 200 ms at 500 tasks.
- OpenCode state changes appear within 5 seconds during a healthy event stream.
- Reconnection triggers an authoritative resync; missed events are never assumed replayed.

**Constraints**:
- Foreman MUST bind only to `127.0.0.1` and IPv6 loopback where supported.
- OpenCode API calls and runtime process operations stay behind one adapter boundary.
- OpenCode server events are live-only; after disconnect the adapter MUST reconnect and
  query current session state before presenting it as live.
- No direct access to OpenCode's internal database.
- No autonomous dispatch, scheduled runs, or implicit start when a task enters Ready.
- Secrets are not stored in the Foreman SQLite database or browser storage.
- No plugin runtime, GUI plugin API, plugin store, or plugin data migration in the target.

**Scale/Scope**: One local user, multiple local projects, hundreds of tasks, a handful of
concurrent OpenCode sessions. No hosted/multi-user mode.

## Constitution Check

Gates from [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md):

1. **Product identity** — pass: a standalone local web app; plugin architecture is
   removed from the target product.
2. **Article I — owner decides** — pass: Start, prompt, follow-up, retry, interrupt,
   approval, and destructive actions require an explicit UI gesture; Ready alone does
   not execute.
3. **Article II — never access OpenCode's internal database** — pass: all runtime reads
   and writes use `@opencode/client` over supported server APIs/events.
4. **Article III — one task, one session** — enforced by domain guards, transactional
   persistence, a unique session reference, and repeated-start tests.
5. **Article IV — explicit application boundaries** — pass: domain is pure; application
   use cases depend on ports; SQLite and OpenCode are separate adapters.
6. **Article V — degrade, never crash** — pass: local tasks remain available while
   OpenCode is disconnected; stale runtime state is visibly distinguished.
7. **Article VI — data ownership** — pass: Foreman owns task/project/activity data;
   OpenCode owns transcripts and runtime state.
8. **Article VII — test and verify** — pass: unit, integration, security, and Playwright
   checks are required before completion.
9. **Article VIII — isolate OpenCode integration** — pass: only the OpenCode adapter
   imports/calls `@opencode/client` or manages its process.
10. **Article IX — SQLite and recoverability** — pass: migrations and explicit backup/
    restore are part of the delivery.
11. **Article X — secure local boundary** — pass: loopback-only bind, origin/host checks,
    CSRF protection, and secret redaction are release gates.

## Architecture

### Runtime topology

```text
Browser (localhost)
       │ same-origin HTTP / SSE
       ▼
Foreman Node.js process
  ├── Fastify HTTP server + security middleware
  ├── Application use cases
  ├── Domain (pure TypeScript)
  ├── SQLite persistence adapter ── foreman.sqlite
  └── OpenCode adapter
       ├── HTTP client + event subscription
       └── managed `opencode serve` process (optional)
                    │
                    ▼
              OpenCode runtime
```

### Layer boundaries

```text
src/
├── domain/                 # entities, invariants, pure decisions
├── application/            # use cases, ports, orchestration
├── adapters/
│   ├── persistence/sqlite/ # schema, migrations, repositories, backup
│   └── opencode/           # client, events, health, process lifecycle
├── server/                 # Fastify app, routes, security, bootstrap
├── ui/                     # SolidJS app, routes, components, styles
└── shared/                 # API DTOs and validation contracts only
```

Rules:
- `domain/` imports no UI, Fastify, SQLite, filesystem, process, or OpenCode modules.
- `application/` defines ports and use cases; it does not import concrete adapters.
- `adapters/` implement ports. OpenCode and SQLite adapters never import each other.
- `server/` wires dependencies and exposes application use cases over same-origin APIs.
- `ui/` calls only Foreman's API; it never receives OpenCode credentials or calls the
  OpenCode endpoint directly.

### OpenCode integration

Use `@opencode/client` from the Node.js process for both connection modes. In managed
mode, the process adapter uses the documented `@opencode/client/service` lifecycle
helpers with a Foreman-specific registration file, checks health, and stops only the
exact service instance it owns during graceful shutdown. If the helper cannot guarantee
instance ownership for the pinned runtime, the adapter uses an explicitly spawned
`opencode serve` child and tracks that child directly. In external-server mode, the
adapter connects to a user-configured endpoint and never stops that server. Both modes
use the same typed client interface.

The adapter consumes the typed event stream for low-latency updates. OpenCode documents
event subscriptions as live-only with no replay/automatic reconnection, so every
reconnect MUST resubscribe and reconcile linked sessions using current API reads before
clearing stale indicators. Session creation must persist the returned session id before
attempting the initial prompt; a prompt failure must retain that id for safe resend.

OpenCode currently documents `@opencode/client` as its TypeScript HTTP API client and
documents `@opencode/client/service` for local background-service management. The
implementation will validate service registration and ownership semantics against the
exact pinned runtime before relying on the service helper.

## Persistence Design

- `tasks`: task intent, project reference/path, column, agent/model selection, timestamps,
  optional unique OpenCode session id, last known error summary.
- `projects`: stable local project identity, directory, display name, last-seen metadata.
- `activity_events`: append-only user-visible events with task/project references and
  safe structured metadata; never transcript content or secrets.
- `app_settings`: non-secret connection mode/endpoint and UI preferences.
- Secrets: OS credential vault adapter where supported; otherwise prompt for the secret
  per process session and do not persist it.
- Migrations: ordered, versioned SQL migrations with transactional application and a
  `schema_migrations` ledger.
- Backup: SQLite online backup/snapshot plus manifest and schema version; exclude
  credentials, provider secrets, and transcripts.
- Restore: stop writes, validate archive/manifest/schema/integrity, stage to a temporary
  file, then atomically replace the active database; preserve a rollback copy.

## Security Design

- Bind explicitly to IPv4 loopback and IPv6 loopback where supported; never bind `0.0.0.0`
  or a LAN/Tailscale interface.
- Validate Host and Origin on every browser request; reject unexpected hostnames,
  origins, and cross-origin state-changing requests.
- Use a same-origin session/CSRF token for mutations; do not enable permissive CORS.
- Keep OpenCode credentials server-side and outside SQLite, browser storage, exports,
  URLs, task data, and diagnostic logs.
- Validate project paths and constrain filesystem writes (including lesson files) to the
  selected project directory.
- Bind only one Foreman instance to its selected local port; fail safely if the port is
  occupied rather than silently exposing another interface.

## Project Structure

```text
package.json
vite.config.ts
tsconfig.json
src/
├── domain/
├── application/
├── adapters/persistence/sqlite/
├── adapters/opencode/
├── server/
├── ui/
└── shared/
tests/
├── unit/
├── integration/
├── security/
└── e2e/
specs/004-standalone-app/
├── spec.md
├── constitution-amendment.md
├── plan.md
└── tasks.md
```

The current `src/gui*`, `src/stores.ts`, and plugin-specific build entry remain only as
temporary reference material until standalone parity is verified. They are removed in
the final decommissioning phase, not wired into the standalone runtime.

## Delivery Strategy

Deliver vertical slices with tests first. Establish domain/application/persistence and
the local server before migrating the Board. Bring up OpenCode connectivity and runtime
health before enabling execution actions. Ship task management and explicit execution
before attention/inbox polish. Backup/restore and security verification are release
gates. Remove the plugin implementation only after all standalone acceptance tests pass.

## Phase 1 Implementation Contract

Phase 1 touches Constitution Articles II, III, IV, VI, and IX. It does not implement an
OpenCode client, process lifecycle, server, or UI. Domain and persistence code must remain
independent of `@opencode/client`, `@opencode/plugin`, and browser/UI packages.

- **Task** retains the Feature 001 fields and four-column semantics. Its id and
  `createdAt` are immutable; `updatedAt` cannot move backwards; `sessionID` is assigned
  only through an atomic repository claim and cannot be replaced. `doing` requires a
  linked session.
- **Project** has a stable id, display name, absolute local directory, and immutable
  creation timestamp. Project directory is unique in SQLite.
- **ActivityEvent** is an append-only summary with optional task/project references and
  bounded JSON metadata. Metadata rejects transcript, prompt, credential, token,
  password, and authorization-shaped keys; it has no transcript/body payload field.
- **Application ports** define Task, Project, and Activity repositories, transaction
  execution, the OpenCode gateway contract, and a separate secret store. Only adapters
  implement infrastructure effects.
- **SQLite v1** uses a migration ledger and transactional ordered migrations. It owns
  projects, tasks, and activity only; it does not attach to or inspect OpenCode storage.
  A nullable unique `session_id` plus an immutability trigger enforces the one-task/one-
  session rule at the database boundary.
- **Recovery** runs `PRAGMA integrity_check`, rejects newer unsupported schemas, rolls
  back failed migrations, supports read-only open for an already-migrated database, and
  returns a generic degraded startup error with a separate diagnostic cause.

The implementation is deliberately synchronous at the SQLite adapter boundary using
`better-sqlite3`; application ports remain replaceable and domain logic stays pure.
The current exact native dependency pin is `better-sqlite3` 12.8.0: it was verified on
Node 22.23.5 and 24.15.0 in the Windows reference environment. The npm-latest 13.2.0
fallback attempted a source build under Node 22 and could not complete because this host
does not have the Visual C++ toolset; the older compatible pin avoids making that toolset
a prerequisite for the supported developer setup.

## Phase 2 Implementation Contract

Phase 2 touches Constitution Articles V, VII, and X. It introduces the standalone HTTP
boundary without starting or depending on an OpenCode runtime. The existing plugin build
remains quarantined as a temporary reference until standalone UI parity and final
decommissioning gates are satisfied.

- **Server**: Fastify is created by `src/server/server.ts`. Its bind host is restricted to
  `127.0.0.1` or `::1`; the CLI starts IPv4 and adds IPv6 on the same port when the OS
  supports it. A requested non-loopback bind is rejected before listen. Occupied ports
  fail startup; the CLI does not silently select another externally visible interface.
- **Host/Origin**: every request validates the Host header against a loopback hostname and
  the actual accepted socket's local port. Origin, when present, must be exact same-origin
  HTTP. State-changing requests require an Origin, a process-memory session cookie, and a
  timing-safe CSRF token. No permissive CORS headers are emitted.
- **Browser boundary**: session cookies are HttpOnly and SameSite=Strict. Security
  response headers include CSP, frame denial, MIME sniffing protection, referrer policy,
  and same-origin resource policy. API responses are not cached. Request-sensitive log
  fields are redacted; request logging is disabled and unexpected failures are logged
  without request bodies or credentials.
- **Static delivery**: when a built client root is supplied, static assets are served and
  non-API GET routes fall back to `index.html`. API misses remain JSON 404 responses.
- **CLI**: `npm run dev` starts the TypeScript CLI; `npm run build:server` emits
  `dist/server/cli.js`; `npm start` runs that compiled entrypoint; package installs expose
  the `foreman` executable through `bin`. `FOREMAN_PORT` selects
  a validated port (default 4317), and `FOREMAN_NO_OPEN=1` suppresses automatic browser
  opening. The current aggregate `build` also creates the temporary plugin reference
  bundle; it is not yet the final standalone client/server distribution because the UI
  entrypoint is delivered in Phase 4.
- **Lifecycle**: the CLI owns only the Fastify listeners it creates. Graceful close shuts
  down both loopback listeners and clears in-memory browser sessions. No OpenCode service,
  process, endpoint, or credential is touched in this phase.

Phase 2 verification includes HTTP-level Host/Origin/CSRF tests, occupied-port and loopback
tests, static SPA fallback tests, CLI startup without OpenCode, and listener shutdown.

## Risks

| Risk | Mitigation |
|---|---|
| OpenCode API/event contract changes | Pin and test supported versions; isolate all calls in adapter; reconcile on reconnect |
| Missed live events | Treat streams as live-only; resubscribe and re-read linked sessions after every reconnect |
| Duplicate sessions on double-click/retry | Atomic task start guard, idempotent use case, unique session reference, concurrency tests |
| Managed server shutdown kills a user-owned process | Use a Foreman-specific service registration; stop only the exact instance Foreman owns |
| SQLite native module install issues | Validate Node/platform matrix early; lock dependency versions and test clean install |
| Localhost web service abused by another origin | Host/Origin checks, CSRF token, loopback-only binding, security tests |
| Secret leakage through exports/logs | Central redaction, OS vault boundary, export allowlist, automated tests |
| Premature plugin deletion loses behavioural reference | Keep old code until standalone parity and acceptance suite pass |

## Out of Scope

Electron/Tauri packaging, LAN/Tailscale/public access, cloud sync, multi-user tenancy,
other agent runtimes, autonomous dispatch, parallel sessions per task, plugin data
migration, and a full OpenCode transcript/chat replacement.

## Research References

- [ADR-0001](../../docs/architecture/decisions/0001-standalone-runtime-baseline.md):
  accepted Node/OpenCode compatibility matrix, smoke-test evidence, and package script
  contract.

- [OpenCode JavaScript client](https://opencode.ai/docs/build/client): `@opencode/client`
  is the typed HTTP API client; event subscriptions are live-only and require reconnect
  plus reconciliation; Node service helpers are documented separately.
- [OpenCode API reference](https://opencode.ai/docs/api): current server endpoints,
  including sessions, prompts, permissions, forms, and events.
- [OpenCode SDK overview](https://opencode.ai/docs/build/sdk): distinguishes the embedded
  `@opencode/sdk` host from the network client; Foreman uses the network client to keep
  OpenCode an external runtime.
