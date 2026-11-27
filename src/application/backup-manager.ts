import { randomUUID } from "node:crypto"
import { SqliteDatabase } from "../adapters/persistence/sqlite/database"
import { createBackupArchive, inspectBackupArchive, stageBackupDatabase, type BackupManifest } from "../adapters/persistence/sqlite/backup-archive"

type PendingRestore = { token: string; manifest: BackupManifest; stagedPath: string; cleanup(): void; expiresAt: number }

export class ForemanBackupManager {
  private pending?: PendingRestore
  private maintenance = false

  constructor(private readonly database: SqliteDatabase) {}

  get isRestoring() { return this.maintenance }

  createBackup() { return createBackupArchive(this.database) }

  previewRestore(archive: Buffer) {
    this.discardPending()
    const inspected = inspectBackupArchive(archive, this.database.schemaVersion())
    const staged = stageBackupDatabase(inspected.database)
    try {
      const validation = new SqliteDatabase(staged.path, { readonly: true })
      try {
        const integrity = validation.connection.pragma("integrity_check") as Array<{ integrity_check: string }>
        if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("Staged database failed SQLite integrity verification")
        if (validation.schemaVersion() !== inspected.manifest.schemaVersion) throw new Error("Staged database schema does not match the backup manifest")
        const tableNames = new Set((validation.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name))
        for (const required of ["tasks", "projects", "activity_events", "runtime_connection_settings", "schema_migrations"]) {
          if (!tableNames.has(required)) throw new Error(`Backup is missing required Foreman table: ${required}`)
        }
        const counts = {
          tasks: (validation.connection.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
          projects: (validation.connection.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count,
          activities: (validation.connection.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count,
        }
        const secretRows = (validation.connection.prepare("SELECT COUNT(*) AS count FROM runtime_connection_settings").get() as { count: number }).count
        if (secretRows !== 0) throw new Error("Backup contains runtime connection settings and cannot be restored safely")
        const token = randomUUID()
        this.pending = { token, manifest: inspected.manifest, stagedPath: staged.path, cleanup: staged.cleanup, expiresAt: Date.now() + 10 * 60_000 }
        return { token, manifest: inspected.manifest, counts, expiresInSeconds: 600 }
      } finally { validation.close() }
    } catch (error) { staged.cleanup(); throw error }
  }

  confirmRestore(token: string) {
    const pending = this.pending
    if (!pending || pending.token !== token || pending.expiresAt <= Date.now()) {
      this.discardPending()
      throw new Error("Restore preview expired. Upload the backup again to preview it.")
    }
    if (this.maintenance) throw new Error("A restore is already in progress")
    this.maintenance = true
    try {
      this.database.replaceFromFile(pending.stagedPath)
      this.pending = undefined
      pending.cleanup()
      return { restored: true, rollbackAvailable: true, manifest: pending.manifest }
    } finally { this.maintenance = false }
  }

  close() { this.discardPending() }

  private discardPending() {
    if (!this.pending) return
    try { this.pending.cleanup() } catch { /* best effort temporary file cleanup */ }
    this.pending = undefined
  }
}
