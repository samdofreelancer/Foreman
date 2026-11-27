# Verify SQLite Migrations: Rollback + Corrupt-Database Startup Coverage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Lock in test coverage for SQLite migration in-place upgrade, per-migration rollback boundary, and corrupt-database startup. No production code changes; behavior is already correct.

**Architecture:** Add Vitest cases to existing suites against temporary real SQLite files (no mocks). `SqliteDatabase` already runs each migration in its own `better-sqlite3` transaction, checks `PRAGMA integrity_check`, throws `DatabaseStartupError`, and `initializeForeman` degrades without deleting the original.

**Tech Stack:** TypeScript, Vitest, better-sqlite3.

**Spec:** `specs/004-standalone-app/tasks.md` T013/T014; `specs/004-standalone-app/plan.md` Recovery; user request "Verify SQLite migrations — Cover rollback and corrupt-database startup."

## Global Constraints

- No production code changes.
- Temporary real SQLite files; no mocks; style matches existing tests in `tests/sqlite-repositories.test.ts` / `tests/server-bootstrap.test.ts`.
- Latest schema version = `migrations.at(-1)!.version` (currently 3); read it from `migrations`, don't hardcode.
- Preserve user changes already in the working tree (untouched files: `src/adapters/opencode/*`, `src/ui/workspace.tsx`, `tests/managed-process.test.ts`, `tests/runtime-connection.test.ts`).

## Review Focus

- A v1/v2 database upgrades in place with data preserved and no re-running applied migrations.
- A failing later migration rolls back only itself; earlier migrations stay applied; ledger not polluted; conflicting pre-existing object not removed.
- Corrupt *valid-SQLite-but-malformed* file (not just a non-SQLite string) → `DatabaseStartupError`, original bytes untouched.
- Bootstrap degraded mode for a malformed SQLite DB; original not modified/deleted; `transaction` throws while degraded.
- Corrupt-database case at `readonly` startup → `DatabaseStartupError`.
- (Already covered, re-verified: failed first migration rolls back + empty ledger; transaction rollback; restore rollback; future-schema rejection; read-only startup.)

---

### Task 1: In-place upgrade from earlier schema version

**Files:**
- Modify: `tests/sqlite-repositories.test.ts`

**Interfaces:** Consumes `migrations`, `SqliteDatabase`, `Database`; produces no new exports.

- [x] **Step 1: Write test** — seed schema-v1-only DB + project row; reopen with `SqliteDatabase`; expect `schemaVersion()` = latest, row preserved, `schema_migrations` = all versions.
- [x] **Step 2: Run** `npx vitest run tests/sqlite-repositories.test.ts` Expected: PASS (existing correct behavior; verify test isn't vacuous via negative control in Task 4).
- [x] **Step 3: Commit.**

### Task 2: Per-migration rollback boundary

**Files:**
- Modify: `tests/sqlite-repositories.test.ts`

- [x] **Step 1: Write test** — seed schema-v1-only DB; pre-create conflicting `task_start_claims` + sentinel row; `new SqliteDatabase` throws `DatabaseStartupError`; raw read-only reopen: ledger = `[{version:1}]`, `tasks` has no `initial_prompt_state`, sentinel intact, `projects` intact.
- [x] **Step 2: Run** `npx vitest run tests/sqlite-repositories.test.ts` Expected: PASS.
- [x] **Step 3: Commit.**

### Task 3: Corrupt-database startup

**Files:**
- Modify: `tests/sqlite-repositories.test.ts`
- Modify: `tests/server-bootstrap.test.ts`

- [x] **Step 1 (sqlite):** seed real DB + row; close; flip bytes mid-file; snapshot; `new SqliteDatabase` throws `DatabaseStartupError` matching `/malformed|not a database/i`; file bytes unchanged.
- [x] **Step 2 (sqlite readonly):** corrupt real DB; `new SqliteDatabase(path, { readonly: true })` throws `DatabaseStartupError`.
- [x] **Step 3 (bootstrap):** seed `initializeForeman`, close; corrupt mid-file; `initializeForeman` → `degraded` + `schemaVersion 0` + "original data has not been deleted"; `transaction` throws `/unavailable/i`; file bytes unchanged; close.
- [x] **Step 4: Run** `npx vitest run tests/sqlite-repositories.test.ts tests/server-bootstrap.test.ts` Expected: PASS.
- [x] **Step 5: Commit.**

### Task 4: Negative controls + full verification

- [x] **Step 1:** temporarily disable migration transaction in `src/adapters/persistence/sqlite/database.ts`; run Task 2 test → must FAIL; restore.
- [x] **Step 2:** restore; run `npx vitest run` (full suite) → all pass.
- [x] **Step 3:** `npm run typecheck` → clean.
- [x] **Step 4:** `git diff --check` → clean.

