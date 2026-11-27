# Feature 004 Verification Log

## 2026-11-26 — Planning baseline

Repository: `C:\Users\ADMIN\Documents\working\Foreman`  
Current branch: `002-run` (the planned `004-standalone-app` branch has not been created).

| Check | Result | Notes |
|---|---|---|
| `git diff --check` | Pass | Only a Git LF→CRLF working-copy warning for Constitution; no whitespace errors. |
| `npm test -- --run` | Pass | 9 test files, 52 tests passed. |
| `npm run typecheck` | Pass | `tsc --noEmit` completed without diagnostics. |
| `npm run build` | Pass | Existing plugin bundle still builds to `dist/gui-experimental.cjs` (29.45 kB, gzip 8.73 kB). This is the pre-migration baseline, not the target standalone build. |

No application source code was changed during this planning pass. The build still targets
the existing plugin because standalone implementation and plugin decommissioning are
future tasks in `tasks.md`.

## OpenCode integration research

- The official JavaScript client documentation identifies `@opencode/client` as the
  TypeScript client for the OpenCode HTTP API and documents async-iterable event streams.
- The same documentation states event subscriptions are live-only, with no replay or
  automatic reconnection; reconnect must be followed by a new subscription and state
  reconciliation.
- The documentation exposes Node service helpers under `@opencode/client/service` for
  discovering, ensuring, and stopping local background services. Exact service ownership
  semantics must be validated against the pinned OpenCode runtime before implementation.
- The embedded `@opencode/sdk` is intentionally not selected: Foreman will connect to an
  external OpenCode server so runtime ownership stays behind the OpenCode adapter.

References: [JavaScript client](https://opencode.ai/docs/build/client),
[API reference](https://opencode.ai/docs/api),
[SDK overview](https://opencode.ai/docs/build/sdk).

## 2026-11-26 — Phase 0: Architecture guardrails

### Environment and compatibility

| Check | Result | Notes |
|---|---|---|
| Node.js 24.15.0 | Pass | Reference Windows x64 development runtime. |
| OpenCode CLI 2.4.2 | Pass | Invoked ephemerally with `npx`; global CLI was not replaced. |
| `@opencode/client` 2.4.2 → `server.info` | Pass | Returned server version 2.4.2. |
| `@opencode/client` 2.4.2 → `session.list` | Pass | Returned an empty session page from an isolated test DB. |
| `@opencode/client` 2.4.2 → `event.subscribe` | Pass | Received `server.connected`. |
| OpenCode CLI 1.19.6 compatibility | Not supported | Session list and events worked, but `server.info` failed with `UnsupportedContentType: text/html`. |
| `Service.ensure` / `Service.stop` lifecycle | Deferred | Windows shared-service ownership interfered with the isolated custom-registration probe. No user-owned OpenCode process was stopped. Must be tested with a deterministic isolated process harness in Phase 3. |

The v2 API probe used `127.0.0.1`, temporary XDG config/data directories, and a temporary
`OPENCODE_DB`. It did not read or modify the user's OpenCode database. All probe servers
were stopped; port 4099 was confirmed closed afterward. The user's global
`opencode-ai` 1.19.6 and OpenCode Desktop installation were left unchanged.

### Architecture guardrails

- Added `tests/architecture-boundaries.test.ts`.
- Domain imports are restricted to other domain modules and the currently approved pure
  `effect` schema package. Runtime, UI, server, filesystem/process, SQLite, and OpenCode
  imports are rejected.
- OpenCode plugin-host imports are restricted to the quarantined legacy GUI/store files
  and the transitional Vite plugin build config. New standalone source layers cannot
  import `@opencode/plugin`.
- Added `test:architecture` and `check:architecture` package scripts.
- Renamed the transitional bundle build to `build:plugin-reference`; `build` remains an
  alias until the standalone build exists.
- Recorded the runtime/version policy and final script/build-output contract in
  `docs/architecture/decisions/0001-standalone-runtime-baseline.md`.

### Phase 0 verification

| Check | Result | Notes |
|---|---|---|
| `npm test -- --run` | Pass | 10 test files, 54 tests passed (including 2 new architecture tests). |
| `npm run typecheck` | Pass | No TypeScript diagnostics. |
| `npm run build` | Pass | Transitional plugin reference bundle remains the current output. |
| `npm run test:architecture` | Pass | 2 architecture boundary tests passed. |
| `git diff --check` | Pass | No whitespace errors; Git reports normal LF→CRLF warnings on Windows. |

Node.js 22.x has not yet been exercised in this environment and remains a CI matrix
release check. Managed service lifecycle isolation is also still a Phase 3 release gate.

## 2026-11-26 — OpenCode client promotion and re-verification

- Promoted `@opencode/client` to a direct production dependency and pinned it to the
  exact latest v2 release available from npm at this check: `2.4.2`.
- Confirmed `@opencode/cli` and `@opencode/client` both resolve to npm latest `2.4.2`.
- Re-ran the SDK smoke test against an isolated OpenCode 2.4.2 server on
  `127.0.0.1:4197`, using temporary XDG config/data directories and a temporary
  `OPENCODE_DB`. `server.info` returned `2.4.2`, `session.list` returned a valid empty
  page, and `event.subscribe` received `server.connected`.
- The smoke test authenticated with the isolated server's generated password. The
  server was stopped after the test; no user OpenCode database or process was touched.
- `npm ls @opencode/client @opencode/plugin`: pass; direct client is 2.4.2 and the
  plugin's client dependency is deduplicated to the same version.
- Full verification after dependency promotion: `npm test -- --run` (10 files, 54
  tests), `npm run typecheck`, `npm run test:architecture` (2 tests), `npm run build`,
  and `git diff --check` all pass.
- `npm install` reports 27 audit findings in the existing dependency graph (25
  moderate, 2 critical). No automatic audit fix was applied because that would broaden
  this targeted SDK upgrade into unrelated dependency changes.

## 2026-11-27 — Phase 1: Domain, ports, and SQLite

### Implementation

- Added pure Project and ActivityEvent domain entities with validation, immutable
  identity/creation timestamps, monotonic update timestamps, and bounded structured
  activity metadata. Tightened Task timestamp and update validation while preserving
  the legacy feature fields and four-column semantics.
- Added application ports for TaskRepository, ProjectRepository, ActivityRepository,
  TransactionRunner, OpenCodeGateway, and SecretStore. No adapter or UI imports leak
  into the domain.
- Added `better-sqlite3` 12.8.0 with TypeScript declarations. SQLite v1 creates a schema
  migration ledger, projects, tasks, activity events, and supporting indexes.
- Evaluated npm-latest `better-sqlite3` 13.2.0 but rejected it for this Windows baseline:
  Node 22 fell back to a native source build and failed because the host lacks the MSVC
  C++ toolset. Version 12.8.0 rebuilt and passed on both supported Node versions.
- Task persistence uses a nullable unique `session_id`, an immutable-session trigger,
  an atomic claim operation, and a database check that `doing` requires a linked session.
- Project and Activity repositories support CRUD/query operations. Activity metadata is
  revalidated at persistence time and rejects sensitive/transcript-shaped keys.
- Startup performs SQLite integrity checks, ordered transactional migrations, rejects
  newer schema versions, supports read-only mode for a current schema, and reports
  generic degraded-mode errors while retaining diagnostic causes separately.

### Verification

| Check | Node.js 22.23.5 | Node.js 24.15.0 |
|---|---:|---:|
| Full Vitest suite | Pass — 69 tests | Pass — 69 tests |
| TypeScript typecheck | Pass | Pass |
| Architecture boundary tests | Included in full suite — 3 pass | Pass — 3 tests |
| Production build | Not separately repeated | Pass — transitional plugin reference bundle |
| `git diff --check` | — | Pass |

SQLite repository tests use temporary database files and cover empty-database
migration, CRUD, transaction rollback, corruption, future schema rejection, read-only
startup, safe activity persistence, and competing session claims from two SQLite
connections. Native `better-sqlite3` bindings were rebuilt for each Node ABI before
testing; this is expected for a native module and does not change the lockfile.

The standalone server/UI and OpenCode adapter are intentionally not implemented in this
phase. Managed OpenCode service lifecycle remains a Phase 3 release gate.

## 2026-11-27 — Phase 2: Standalone server and local security

### Implementation

- Added `src/server/security.ts` for explicit loopback bind validation, Host validation
  against the actual socket port, same-origin checks, and constant-time CSRF comparison.
- Added `src/server/server.ts` with Fastify bootstrap, IPv4 loopback binding, optional
  IPv6 loopback listener on the same port, health/session APIs, in-memory browser sessions,
  same-origin mutation protection, restrictive response headers, redacted structured
  logging, normalized errors, static asset serving, and SPA route fallback.
- Added `src/server/cli.ts`. The CLI validates `FOREMAN_PORT` (default 4317), starts
  Foreman without OpenCode, reports the local URL, optionally opens the browser, and
  gracefully closes the listeners on SIGINT/SIGTERM. `FOREMAN_NO_OPEN=1` disables browser
  opening.
- Added `dev`, `build:server`, and `start` scripts. `build` now builds the server and the
  temporary plugin reference bundle; the final standalone browser bundle remains a
  Phase 4 deliverable because no standalone UI entrypoint exists yet.
- Added security and CLI tests. Host spoofing uses `node:http` rather than Fetch because
  the Fetch implementation normalizes/replaces the supplied Host header; this ensures the
  DNS-rebinding-style test exercises the actual wire-level Host value.

### Verification

| Check | Result | Notes |
|---|---|---|
| Security integration tests | Pass | IPv4 bind, optional IPv6 bind, non-loopback rejection, occupied port, Host mismatch, cross-origin Origin, CSRF, security headers, static assets, SPA fallback, API 404. |
| CLI tests | Pass | Starts and serves `/api/health` without OpenCode; validates ports; closes listeners. |
| `npm run typecheck` | Pass | No TypeScript diagnostics after normalizing Fastify header/error types. |
| `npm run build:server` | Pass | Emits `dist/server/cli.js` using tsup for Node 22. |

Compiled CLI smoke test: started `node dist/server/cli.js` with `FOREMAN_PORT=4317` and
`FOREMAN_NO_OPEN=1`; `/api/health` returned HTTP 200 with `{"status":"ok"}` while no
OpenCode runtime was started. A request with `Host: attacker.example:4317` returned
HTTP 403. The CLI process was interrupted and its owned listeners were closed. No
OpenCode process or database was accessed.

### Final Phase 2 verification

| Check | Result | Notes |
|---|---|---|
| `npm test -- --run` | Pass | 15 test files, **80/80 tests passed**. |
| `npm run typecheck` | Pass | No TypeScript diagnostics. |
| `npm run check:architecture` | Pass | Typecheck plus 3/3 architecture boundary tests. |
| `npm run build` | Pass | Node server CLI built to `dist/server/cli.js`; temporary plugin reference bundle built to `dist/gui-experimental.cjs`. This is still a transition build, not the final standalone UI distribution. |
| `git diff --check` | Pass | No whitespace errors; only normal Windows LF→CRLF warnings. |

The test suite includes 7 HTTP security integration tests and 4 standalone CLI tests.
IPv6 loopback was available and passed in this Windows environment. The compiled server
smoke test confirmed HTTP 200 health and HTTP 403 for an attacker-controlled Host value.
No OpenCode process, service, endpoint, credential, or database was used during Phase 2.

### Runtime matrix and package entrypoint re-check

| Check | Node.js 22.23.5 | Node.js 24.15.0 |
|---|---:|---:|
| Full Vitest suite | Pass — 80/80 tests | Pass — 80/80 tests |
| TypeScript typecheck | Pass | Pass |
| Standalone server build (Node 22 target) | Pass | Pass |

The Node 22 run used a Node-22-ABI rebuild of `better-sqlite3` before executing the full
suite; the Node 24 run used the matching Node-24-ABI binding. `npm pack --dry-run` also
passed for `foreman@0.1.0`, confirming the package metadata and `foreman` bin mapping are
valid. The package remains transitional: it still contains the quarantined plugin
reference bundle until the standalone UI and decommissioning gates are complete.

## 2026-11-27 — Phase 3: OpenCode adapter and connection lifecycle

### Implementation

- Added `src/adapters/opencode/gateway.ts`, the only adapter using the pinned
  `@opencode/client` 2.4.2 Promise SDK. It maps health/version/capabilities, project
  discovery, session create/read, prompt/follow-up, interrupt, pending permission/form
  reads and explicit replies, plus the typed event stream.
- The adapter accepts only the OpenCode 2.4.x server line. Endpoint validation rejects
  invalid schemes, URL-embedded credentials, query/fragment components, and cleartext
  credentials to non-loopback endpoints. Basic auth headers remain server-side.
- Event delivery is allowlisted to lifecycle, project, permission, and form events.
  Transcript text, prompt content, and tool deltas are discarded before events cross the
  adapter boundary. Event consumption preserves stream backpressure.
- Added `ManagedOpenCodeProcess`, which starts `opencode serve` on an ephemeral IPv4
  loopback port, tracks the exact spawned child, applies a startup timeout, and stops only
  that child. The shared `@opencode/client/service` registration helpers are not used
  because their ownership semantics were not proven safe beside the Desktop service.
- Added `RuntimeConnection` for managed/external mode selection. Mode switching requires
  explicit disconnect; external disconnect only drops the client reference. External
  credentials are retrieved from `SecretStore` and missing configured credentials fail
  closed. Managed mode validates the server API and uses the configured server credentials.
- Added `ConnectionSupervisor` with startup timeout, health polling, stale/disconnected
  states, abortable event streams, exponential reconnect delay, resubscription, and
  mandatory reconciliation of every linked session before reporting a recovered stream
  as connected.
- Added `MemorySecretStore`, Windows Credential Manager storage via PowerShell/.NET
  interop (secret payload is sent through stdin, not argv), and process-memory fallback.
  Non-Windows platforms currently use process-memory storage pending native Keychain and
  Secret Service adapters. If persistent deletion cannot be verified during vault failure,
  the adapter reports an error rather than claiming the credential was deleted.
- Added ADR-0002 documenting process ownership, compatibility, event filtering, and secret
  handling. Architecture tests now ensure only `src/adapters/opencode/` imports the SDK.

### Verification

| Check | Result | Notes |
|---|---|---|
| Full Vitest suite | Pass | 20 test files, **110/110 tests passed**. |
| OpenCode adapter contract tests | Pass | Health/version, project discovery, session lifecycle, prompts/follow-up, interrupt, permission/form mapping, event filtering, endpoint validation and unsupported runtime. |
| Connection lifecycle tests | Pass | Reconnect, stream termination, abort on disconnect, missed-event reconciliation, stale state, startup timeout and external/managed ownership. |
| Process ownership tests | Pass | Managed process stops only its tracked child; external disconnect never stops the server. |
| Secret-store tests | Pass | Windows Credential Manager read-only missing-entry probe, memory fallback, endpoint credential handling and delete-failure reporting. No real credential was created or changed. |
| Persistence regression | Pass | Simulated managed runtime exit leaves Foreman SQLite task records unchanged. |
| TypeScript typecheck | Pass | `npm run typecheck`. |
| Architecture checks | Pass | `npm run check:architecture`; 4/4 boundary tests. |
| Production build | Pass | Node server bundle and temporary plugin reference bundle both build. |
| `git diff --check` | Pass | No whitespace errors; only expected Windows LF→CRLF warnings. |

### Isolated OpenCode 2.4.2 integration smoke test

- Verified `npm exec --yes --package=@opencode/cli@2.4.2 -- opencode --version` reports
  `opencode v2.4.2`; the global legacy CLI was not replaced.
- Started the exact cached 2.4.2 executable as a Foreman-owned child with temporary
  XDG config/data/state paths, a temporary `OPENCODE_DB`, a temporary project directory,
  and a test-only server password. No Desktop service or user OpenCode database was used.
- Through the actual SDK adapter, verified server version/capabilities, project listing,
  session creation/readback, interrupt, and receipt of `server.connected` on the typed
  event stream. The session did not receive a prompt, so no model/provider inference was
  triggered.
- Repeated the probe through `RuntimeConnection.connectManaged()`: managed mode passed
  health/authentication checks, created/read back a session, and `disconnect()` stopped
  the Foreman-owned child. A post-stop health probe returned disconnected.
- Started a separate isolated server as an external process and connected through
  `RuntimeConnection.connectExternal()`. After Foreman disconnect, a fresh SDK probe still
  returned healthy OpenCode 2.4.2; only the test harness then stopped that isolated server.
- Both isolated databases/config roots were removed after their probes. No Desktop service
  or user OpenCode database was used.
- No real user credential was written to Windows Credential Manager; its tested path was
  a read-only lookup for a known non-existent Foreman test key.

### Remaining platform scope

Windows Credential Manager is the verified OS vault for the reference host. macOS
Keychain and Linux Secret Service adapters remain platform follow-ups; those platforms
currently use the process-memory fallback. The application server/UI has not yet wired
runtime settings into this adapter; the server integration and user-facing connection
settings belong to later application/UI phases.

## 2026-11-27 — Phase 4: Standalone UI and application bootstrap

### Implementation

- Added a SolidJS SPA under `src/ui/` with a route model for Board, Projects, Inbox,
  Activity, and Settings. Board is the default route; direct route loads and refreshes
  are handled by the server's SPA fallback.
- Added a responsive application shell with desktop workspace sidebar, mobile navigation
  drawer/backdrop, accessible labels and focus treatment, local service status, and a
  visibly disconnected OpenCode state. Placeholder views identify later delivery phases
  rather than implying unfinished functions are live.
- Added first-run welcome, loading, retryable service failure, and database-degraded
  recovery states with live/alert announcements. The UI reads only same-origin Foreman
  health/session endpoints and never receives OpenCode credentials or calls its endpoint.
- Split Vite configurations: `vite.config.ts` builds the standalone client to
  `dist/client`; `vite.plugin.config.ts` builds the quarantined legacy plugin reference.
  `npm run dev` builds the client before starting the local secured CLI.
- Added `src/server/bootstrap.ts` to initialize the Foreman-owned SQLite database under
  the OS application-data directory, with `FOREMAN_DATA_DIR` override. `/api/health`
  reports database readiness/schema version. If startup detects an unavailable/corrupt
  database, the HTTP server still serves the recovery screen and does not delete the
  original file. CLI shutdown closes both listeners and SQLite.
- Added route/bootstrap unit tests and Playwright desktop/mobile browser tests.

### Verification

| Check | Result | Notes |
|---|---|---|
| Full Vitest suite | Pass | 22 test files, **115/115 tests passed**. |
| Playwright E2E | Pass | **11 passed, 1 skipped** across desktop Chromium and mobile Chromium. The skip is the mobile-drawer-only test in desktop Chromium. |
| TypeScript typecheck | Pass | `npm run typecheck`. |
| Architecture checks | Pass | `npm run check:architecture`; 4/4 boundary tests. |
| Production build | Pass | Standalone client, Node server, and quarantined plugin reference bundle. |
| Production CLI smoke | Pass | Compiled CLI served `/board` (200), `/api/health` (database ready, schema 1), and `/api/session` (200) on an isolated port/data directory. |
| Responsive overflow | Pass | Playwright checks desktop 1440px and mobile 390px viewports. |
| `git diff --check` | Pass | No whitespace errors; expected Windows line-ending warnings only. |

### Scope boundary

Phase 4 delivers the application shell and database lifecycle, not task CRUD. Board task
columns/cards, project discovery, task detail, and activity records are Phase 5. Connection
settings are Phase 8; execution controls are Phase 6. The runtime remains disconnected by
default and the existing Phase 2 development server is not replaced by this verification.
