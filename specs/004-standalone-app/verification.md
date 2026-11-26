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
