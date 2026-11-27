# ADR-0002: OpenCode Runtime Connection and Process Ownership

- **Status**: Accepted
- **Date**: 2026-11-27
- **Feature**: `004-standalone-app`
- **Constitution**: v2.0.0

## Context

Foreman must support both a user-owned OpenCode server and a Foreman-managed local
runtime. The Windows reference environment also has an OpenCode Desktop-owned service.
Stopping a shared registration or discovering and adopting a process by port/PID could
terminate work that Foreman does not own.

## Decisions

1. All runtime operations use the `@opencode/client` 2.4.2 Promise client behind
   `OpenCodeGatewayAdapter`. Only `src/adapters/opencode/` imports the SDK.
2. The initial supported server line is 2.4.x. `server.info()` is authoritative; v1.x,
   other minor lines, and missing/failed version responses are reported as unsupported or
   disconnected. The adapter reports the 2.4.x core API surface and optional server
   capabilities such as persistent PTY support.
3. External mode validates an HTTP(S) endpoint and may use a process-memory secret. It
   never starts, stops, or mutates the remote server lifecycle. Credentials are rejected
   over non-loopback HTTP; remote credentials require HTTPS.
4. Managed mode uses a directly spawned `opencode serve` child bound to `127.0.0.1` on a
   Foreman-selected port. Foreman retains the exact `ChildProcess` handle and sends a stop
   signal only to that handle. It does not discover/adopt existing services and does not
   call the shared `Service.ensure` or `Service.stop` registration helpers.
5. Managed startup has a bounded health gate. Unsupported CLI versions fail startup and
   the child Foreman created is stopped. Unexpected child exit is surfaced to the
   connection supervisor; task data remains in Foreman SQLite.
6. Event streams are live-only. Every stream termination/reconnect is followed by
   authoritative reads of linked sessions before the supervisor reports the connection
   healthy. Event consumption is sequential, allowing stream backpressure; only lifecycle,
   permission, form, and project events are forwarded. Transcript/text/tool-delta payloads
   are discarded at the adapter boundary.
7. Secrets are held by the `SecretStore` port. Windows uses Credential Manager through a
   PowerShell/.NET interop bridge; secret material is sent over stdin, never command-line
   arguments. If the vault is unavailable, Foreman falls back to process-memory storage.
   Other operating systems currently use process-memory storage until their native vault
   adapters are implemented. Secrets are never written to SQLite, browser storage, logs,
   or endpoint URLs.

## Consequences

- Foreman cannot accidentally stop the OpenCode Desktop service in the reference setup.
- Managed mode requires a compatible `opencode` executable on PATH or an explicit
  `FOREMAN_OPENCODE_BIN`/configured executable. The legacy global `opencode-ai` 1.19.6 is
  not accepted; it must not be silently substituted for the 2.4.x runtime.
- External mode is safe to disconnect because it only drops Foreman's client reference.
- Windows Credential Manager is implemented and its read-only missing-entry path is
  verified on the reference host; macOS Keychain and Linux Secret Service remain follow-up
  platform adapters.
