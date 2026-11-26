# Constitution Amendment: Standalone Foreman

**Constitution version**: 1.0.0 → 2.0.0  
**Date**: 2026-11-26  
**Approval**: Owner-approved on 2026-11-26  
**Reason**: Feature 004 repositions Foreman from an OpenCode GUI plugin to an independent
local-first web application.

## Owner-approved architectural direction

Foreman is no longer a plugin. The standalone application owns its browser UI,
application lifecycle, task/project persistence, and local security boundary. OpenCode
is an external execution runtime accessed through supported interfaces.

The first release:

- Runs as a local web application opened in a browser; Electron/Tauri packaging is not
  required.
- Supports Foreman-managed `opencode serve` and a user-managed external OpenCode server.
- Uses a new SQLite database; plugin task data is intentionally not migrated.
- Binds to loopback only. LAN, Tailscale, and public remote access are out of scope.
- Preserves explicit owner initiation, one task/one session, no direct OpenCode database
  access, and OpenCode authority over transcripts/runtime execution state.

## Architectural changes

| Area | Constitution v1.0.0 | Constitution v2.0.0 |
|---|---|---|
| Product surface | OpenCode GUI plugin | Standalone local web application |
| UI boundary | `src/gui/` and plugin host calls | Application/UI layer independent of OpenCode UI |
| Runtime integration | Experimental plugin GUI API isolation | Dedicated OpenCode client/server/process adapter |
| Persistence | Plugin-owned task store; derive run state | Foreman-owned SQLite plus OpenCode-owned runtime/transcripts |
| Testing | Running OpenCode Desktop GUI | Standalone app UI plus supported OpenCode runtime integration |
| Network security | Plugin host assumptions | Loopback-only web service and browser-origin protections |

## Article changes

- **Product identity**: explicitly prohibits plugin, GUI extension, and embedded-panel
  product assumptions.
- **Article I**: retains owner-initiated execution and destructive actions; clarifies
  that moving a task to Ready does not start it.
- **Article II**: retains the prohibition on direct OpenCode database access and defines
  Foreman's separate SQLite ownership.
- **Article III**: preserves the one-task/one-session invariant.
- **Article IV**: replaces the plugin-specific `src/gui/` boundary with pure domain,
  application/UI, OpenCode adapter, and persistence adapter boundaries.
- **Article V**: defines graceful degradation for a standalone application and offline
  OpenCode runtime.
- **Article VI**: distinguishes Foreman task-data authority from OpenCode transcript and
  runtime-state authority.
- **Article VII**: changes verification from plugin-host GUI testing to standalone UI
  and OpenCode runtime integration testing.
- **Article VIII**: replaces experimental GUI-plugin API isolation with a dedicated
  OpenCode integration adapter and prohibits plugin GUI APIs.
- **Article IX (new)**: establishes SQLite ownership, schema migration, backup/restore,
  and the no-plugin-data-migration decision.
- **Article X (new)**: establishes loopback-only networking, origin protections, and
  secret-handling requirements.

## Compatibility and supersession

Constitution v2.0.0 is a deliberate architectural replacement, not a compatibility
layer. The existing OpenCode plugin is not part of the target product and must not be
retained as a runtime dependency, migration bridge, or supported UI surface. Existing
plugin data is not imported into the new SQLite database.

Feature 001 and Feature 002 remain behavioural requirements to preserve/re-host in the
standalone application; their plugin-specific implementation details are not binding
architecture. Feature 004 remains the product specification and must be reviewed for
consistency with this amendment before planning.

## Migration notes

- Remove plugin-host assumptions and experimental GUI API dependencies from the target
  architecture.
- Keep OpenCode runtime calls behind the adapter boundary.
- Keep domain rules independent from UI, persistence, and runtime infrastructure.
- Do not create `plan.md` or `tasks.md` until Feature 004 and this constitution amendment
  have been reviewed and accepted.
