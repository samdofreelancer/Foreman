# System Overview & Architecture

Foreman is designed as a standalone, task-centric control plane for OpenCode. It shifts the user's focus from managing individual chat sessions to managing tasks on a Kanban board, while relying on OpenCode as the underlying agent execution runtime.

## Architectural Principles

Foreman follows **Clean Architecture** principles to decouple the core business domain from UI frameworks, web servers, databases, and external runtimes.

```
┌─────────────────────────────────────────────────────────────┐
│                       UI Layer (SolidJS)                    │
├─────────────────────────────────────────────────────────────┤
│                    Standalone Server (Fastify)              │
├─────────────────────────────────────────────────────────────┤
│                   Application & Ports Layer                 │
├─────────────────────────────────────────────────────────────┤
│                  Domain Layer (Pure Logic)                  │
└─────────────────────────────────────────────────────────────┘
          ▲                                         ▲
          │                                         │
┌───────────────────┐                     ┌───────────────────┐
│ SQLite Persistence│                     │ OpenCode Adapters │
└───────────────────┘                     └───────────────────┘
```

## Layer Breakdown

### 1. Domain Layer (`src/domain/`)
- **Responsibility:** Contains pure business logic, invariants, entities, and state validators (e.g., `Task`, `Project`, `Activity`, `RunState`, `StartGuard`).
- **Rule:** Zero dependencies on UI, Fastify, OpenCode SDK, or SQLite.

### 2. Application Ports Layer (`src/application/ports/`)
- **Responsibility:** Defines interfaces (ports) that boundary adapters must implement (e.g., `TaskRepository`, `ProjectRepository`, `OpenCodeGateway`, `SecretStore`).

### 3. Adapters Layer (`src/adapters/`)
- **Persistence (`src/adapters/persistence/sqlite/`):** Manages local SQLite connections, transactional migrations, and data persistence for tasks and projects.
- **OpenCode (`src/adapters/opencode/`):** Wraps the `@opencode/client` SDK, manages runtime process lifecycle (managed vs. external mode), handles event subscriptions, and supervises connection health.

### 4. Server Layer (`src/server/`)
- **Responsibility:** Fastify-based local HTTP server.
- **Features:** Strict loopback-only binding, CSRF defense, Host/Origin validation, same-origin session control, static SPA serving, and structured logging.

### 5. UI Layer (`src/ui/`)
- **Responsibility:** SolidJS reactive single-page application.
- **Features:** Kanban board, task detail drawers, project filters, real-time status display, and inbox attention views.
