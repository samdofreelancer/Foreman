# OpenCode Integration & Event Streaming

This document details how Foreman integrates with the OpenCode runtime, manages connection lifecycles, and processes real-time event streams.

## Integration Architecture

Foreman communicates with OpenCode exclusively through HTTP/WebSocket APIs via the official `@opencode/client` package. It does not invoke CLI commands manually.

```
┌──────────────┐         HTTP / SSE         ┌───────────────────┐
│              │ <────────────────────────> │                   │
│   Foreman    │      gateway.health()      │   OpenCode Server │
│ Application  │      session.create()      │    (Managed or    │
│              │      session.prompt()      │     External)     │
│              │ ────────────────────────>  │                   │
│              │     subscribeEvents()      │                   │
└──────────────┘                            └───────────────────┘
```

## 1. Connection Modes

- **Managed Mode:** Foreman spawns and supervises its own loopback-only OpenCode process child, monitoring its health and exit lifecycle.
- **External Mode:** Foreman connects to a pre-configured external OpenCode endpoint, never mutating or stopping an externally managed server.

## 2. Connection Supervisor & Resilience

The `ConnectionSupervisor` (`src/adapters/opencode/connection-supervisor.ts`) governs runtime availability and state synchronization:

- **State Machine:** Tracks statuses (`connected`, `connecting`, `stale`, `disconnected`).
- **Heartbeat Polling:** Periodically checks OpenCode health (every 15 seconds by default).
- **Stream Loss & Reconnection:** If the Server-Sent Events (SSE) stream ends or drops, the supervisor shifts to `stale` and initiates exponential backoff reconnect attempts.
- **Authoritative Reconciliation (`reconcileAll`):** When reconnecting after a network drop, the supervisor queries OpenCode for the live state of all linked sessions, ensuring no missed events compromise the local task state.

## 3. Real-Time Event Streaming

- **Subscription:** `OpenCodeGatewayAdapter.subscribeEvents()` wraps `client.event.subscribe()`.
- **Sanitization:** Raw event payloads are filtered (`safeEventTypes`) and sanitized to strip credentials or raw transcripts.
- **UI Push:** Fastify forwards these normalized events to the SolidJS frontend, allowing the Kanban board and task detail views to update reactively without page reloads.
