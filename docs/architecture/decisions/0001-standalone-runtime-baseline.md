# ADR-0001: Standalone Runtime and OpenCode Compatibility Baseline

- **Status**: Accepted
- **Date**: 2026-11-26
- **Feature**: `004-standalone-app`
- **Constitution**: v2.0.0

## Context

Foreman is moving from an OpenCode GUI plugin to a standalone local web application.
The runtime must own its Node.js process, local HTTP boundary, SQLite data, and browser
assets while treating OpenCode as an external execution service. The existing machine
has both an older `opencode-ai` CLI and a newer OpenCode Desktop installation, so a
package version observed in one environment must not be assumed to identify every
available runtime.

## Decisions

### Node.js

- Minimum supported major: **Node.js 22 LTS**.
- CI/runtime compatibility matrix: **Node.js 22.x and 24.x LTS**.
- Reference development runtime observed during Phase 0: **Node.js 24.15.0, Windows x64**.
- Native SQLite dependency installation and tests must run on both supported majors
  before release. Node 20 and non-LTS/odd majors are not release targets.

### OpenCode API client and server

- Use **`@opencode/client` 2.4.2** as the typed HTTP API client baseline.
- The first supported OpenCode server line is **2.4.x**, with **2.4.2** as the verified
  contract baseline. Pin the client version in the application lockfile; do not float
  the SDK independently of adapter contract tests.
- Treat a server as supported only after `server.info`, session reads, required session
  actions, and event subscription contract tests pass. A successful health request alone
  is insufficient.
- The server-reported version is authoritative. Do not infer server compatibility from
  the installed package version or from OpenCode Desktop's UI version.
- OpenCode v1.x is not in the initial support matrix. Compatibility with v1 would require
  a separately tested adapter implementation and an explicit product decision.

### Managed and external runtime modes

- External mode connects to a user-selected server URL and never stops that server.
- Managed mode uses the Node-only `@opencode/client/service` API with a Foreman-specific
  service registration path. `Service.stop` must only be called for the registration
  Foreman owns. The exact `ensure`/`stop` lifecycle still requires a dedicated Windows
  integration test before Feature 003/Phase 3 is considered complete.
- If service registration cannot be isolated reliably on a supported platform, fall back
  to a directly spawned and explicitly tracked `opencode serve` child process. Never
  adopt or terminate an unrelated user's OpenCode Desktop/TUI service.

### Event handling

- Consume the SDK's typed async event iterable.
- Event subscriptions are live-only: no replay and no automatic reconnect. Every
  reconnect must create a new subscription and reconcile linked sessions using current
  API reads before Foreman clears stale indicators.
- Event consumption must not block on slow UI or persistence work; use a bounded internal
  queue and define overflow/reconciliation behaviour in the adapter.

## Phase 0 Evidence

Environment and package evidence:

| Item | Observed value |
|---|---|
| Node.js | 24.15.0, Windows x64 |
| OpenCode Desktop process | 2.4.2 |
| Global legacy CLI | `opencode-ai` 1.19.6 |
| npm latest `@opencode/cli` | 2.4.2 |
| npm latest `@opencode/client` | 2.4.2 |
| Foreman direct client dependency | `@opencode/client` 2.4.2 (exact version) |
| Plugin dependency client | `@opencode/client` 2.4.2 (deduped) |

An isolated OpenCode 2.4.2 server was started on `127.0.0.1` with temporary XDG config,
data, and SQLite paths. No user database was read or modified. Using the 2.4.2 Promise
client against that server verified:

- `client.server.info()` returned server version `2.4.2`.
- `client.session.list()` returned an empty session page.
- `client.event.subscribe()` received `server.connected`.
- The temporary foreground server was stopped after the probe.

The installed global `opencode-ai` 1.19.6 was also probed with isolated storage. The
2.4.2 client could list sessions and subscribe to events, but `client.server.info()`
failed with `UnsupportedContentType: text/html`. This partial compatibility is not
sufficient for support and is why v1.x is excluded from the initial matrix.

The `Service.ensure` managed-service helper was inspected but not accepted as fully
verified by this probe. The Windows environment already has an OpenCode Desktop-owned
service process, and the custom-registration test did not complete cleanly. A dedicated
isolated process-lifecycle integration test is a release prerequisite; do not use the
default shared service registration from Foreman.

## Package Script and Build Contract

The standalone package will expose these stable commands:

| Script | Contract |
|---|---|
| `dev` | Start the local API server and Vite development assets, loopback only |
| `build` | Build the Node server and browser client |
| `start` | Run the compiled local application |
| `test` | Run all Vitest unit and integration tests |
| `test:architecture` | Run import-boundary and architecture guardrail tests |
| `typecheck` | Run TypeScript strict type checking |
| `test:e2e` | Run Playwright browser acceptance tests |

Target build output:

- `dist/server/index.js` — Node.js application entrypoint.
- `dist/client/index.html` plus hashed JS/CSS assets — browser application.
- No CommonJS OpenCode plugin bundle in the final product.

During transition only, `build:plugin-reference` preserves the existing
`dist/gui-experimental.cjs` build. The current `build` command remains an alias to that
reference build until the standalone server and client entrypoints exist; it must then
switch to the standalone output and the plugin build must be removed.

## Consequences

- The existing global CLI 1.19.6 is not a valid acceptance runtime for Feature 004. The
  supported OpenCode 2.4.2 CLI can be invoked side-by-side without replacing the global
  installation.
- The client is a direct runtime dependency of Foreman, not an implementation detail
  inherited from the legacy plugin. The package manifest pins 2.4.2 exactly and the
  lockfile records the resolved dependency graph.
- Managed-service ownership is a hard release gate; external mode must remain usable even
  when managed lifecycle support is unavailable.
