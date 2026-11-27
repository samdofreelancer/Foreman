# Database & Local Persistence

Foreman maintains its own independent SQLite database to ensure local durability and offline resilience.

## 1. Persistence Independence

- **Local SQLite DB:** Foreman stores all task definitions, project associations, activity logs, and runtime session bindings in a local SQLite file.
- **Decoupled from OpenCode:** Foreman does not read or write directly to OpenCode's internal database. It interacts exclusively through the OpenCode API and stores only reference identifiers (`session_id`).
- **Offline Resilience:** Even if OpenCode is offline, developers can launch Foreman, inspect task boards, review projects, and navigate history (with clear disconnected state indicators).

## 2. Core Schema & Invariants

Managed under `src/adapters/persistence/sqlite/`:

- **Tasks Table:** Stores task ID, title, description, status (`todo`, `ready`, `doing`, `done`), project reference, agent, model configuration, and the immutable `session_id`.
- **Session Invariant:** Enforced at the database level: **one task owns at most one OpenCode session (`session_id` is unique and nullable)**. Retries and follow-ups continue within that exact session.
- **Projects & Activity Tables:** Tracks project metadata and safe, append-only activity records (devoid of raw transcripts or secret payloads).

## 3. Migration & Startup Recovery

- **Ordered Migrations:** Schema changes are version-controlled and applied transactionally via a schema version ledger.
- **Startup Integrity Check:** On startup, the database performs integrity checks, migration verification, and handles degraded/read-only failure modes safely without crashing the application shell.
