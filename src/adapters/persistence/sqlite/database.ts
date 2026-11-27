import Database from "better-sqlite3"
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { TransactionRunner } from "../../../application/ports/repositories"
import { migrations } from "./migrations"

export type DatabaseHealth = { status: "ready" | "degraded"; schemaVersion: number; message?: string }

export class DatabaseStartupError extends Error {
  readonly mode = "degraded" as const
  readonly recoveryAction = "Close Foreman and restore a valid backup, or choose a new database location. The original file was not deleted."
  readonly diagnosticMessage: string

  constructor(diagnosticMessage: string, options?: ErrorOptions) {
    super("Foreman could not safely open its local database.", options)
    this.name = "DatabaseStartupError"
    this.diagnosticMessage = diagnosticMessage
  }
}

export class SqliteDatabase implements TransactionRunner {
  connection!: Database.Database
  private closed = false
  private readonly readOnly: boolean

  constructor(readonly path: string, options: { readonly?: boolean } = {}) {
    this.readOnly = options.readonly ?? false
    try {
      this.connection = new Database(path, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false })
      this.connection.pragma("busy_timeout = 5000")
      this.connection.pragma("foreign_keys = ON")
      if (!options.readonly) this.connection.pragma("journal_mode = WAL")
      this.assertIntegrity()
      if (!options.readonly) this.applyMigrations()
      else if (this.schemaVersion() !== migrations.at(-1)?.version) throw new Error("Database schema requires a writable migration")
    } catch (error) {
      try { this.connection?.close() } catch { /* best-effort close after startup failure */ }
      throw new DatabaseStartupError(
        error instanceof Error ? error.message : "Unknown SQLite startup error",
        { cause: error },
      )
    }
  }

  transaction<T>(operation: () => T): T {
    this.assertOpen()
    if (this.readOnly) throw new Error("Database is in read-only mode")
    return this.connection.transaction(operation)()
  }

  schemaVersion(): number {
    this.assertOpen()
    const exists = this.connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
    if (!exists) return 0
    const row = this.connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }
    return row.version
  }

  health(): DatabaseHealth {
    try {
      this.assertIntegrity()
      return { status: "ready", schemaVersion: this.schemaVersion() }
    } catch (error) {
      return { status: "degraded", schemaVersion: 0, message: "Database integrity check failed. Foreman is in degraded mode." }
    }
  }

  close() {
    if (this.closed) return
    this.connection.close()
    this.closed = true
  }

  /** Replace the live database with a validated SQLite file and retain the old file for rollback. */
  replaceFromFile(stagedPath: string): string {
    this.assertOpen()
    if (this.readOnly) throw new Error("Database is in read-only mode")
    const rollbackPath = join(dirname(this.path), `${basename(this.path)}.rollback-${Date.now()}-${randomUUID()}`)
    const stagedCopy = join(dirname(this.path), `${basename(this.path)}.restore-${randomUUID()}.sqlite`)
    copyFileSync(stagedPath, stagedCopy)
    this.connection.pragma("wal_checkpoint(TRUNCATE)")
    copyFileSync(this.path, rollbackPath)
    this.connection.close()
    this.closed = true
    try {
      renameSync(stagedCopy, this.path)
      this.openConnection()
      this.assertIntegrity()
      if (this.schemaVersion() !== migrations.at(-1)?.version) throw new Error("Restored database schema changed during activation")
      return rollbackPath
    } catch (error) {
      try { this.connection?.close() } catch { /* best effort before rollback */ }
      try {
        if (existsSync(this.path)) rmSync(this.path, { force: true })
        if (existsSync(rollbackPath)) copyFileSync(rollbackPath, this.path)
        rmSync(`${this.path}-wal`, { force: true })
        rmSync(`${this.path}-shm`, { force: true })
        this.closed = true
        this.openConnection()
      } catch (rollbackError) {
        this.closed = true
        throw new Error(`Restore failed and automatic rollback could not reopen the database. The rollback copy was retained at ${rollbackPath}.`, { cause: rollbackError })
      }
      throw error
    } finally {
      if (existsSync(stagedCopy)) rmSync(stagedCopy, { force: true })
    }
  }

  private openConnection() {
    this.connection = new Database(this.path)
    this.connection.pragma("busy_timeout = 5000")
    this.connection.pragma("foreign_keys = ON")
    this.connection.pragma("journal_mode = WAL")
    this.closed = false
  }

  private applyMigrations() {
    this.connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`)
    const applied = new Set((this.connection.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version))
    const latest = migrations.at(-1)?.version ?? 0
    const current = Math.max(0, ...applied)
    if (current > latest) throw new Error(`Database schema version ${current} is newer than this Foreman build supports (${latest})`)
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      this.connection.transaction(() => {
        migration.up(this.connection)
        this.connection.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, Date.now())
      })()
    }
  }

  private assertIntegrity() {
    const result = this.connection.pragma("integrity_check") as Array<{ integrity_check: string }>
    if (result.length !== 1 || result[0].integrity_check !== "ok") throw new Error("SQLite integrity check failed")
  }

  private assertOpen() {
    if (this.closed) throw new Error("Database connection is closed")
  }
}
