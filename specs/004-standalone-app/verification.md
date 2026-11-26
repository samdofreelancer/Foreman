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
