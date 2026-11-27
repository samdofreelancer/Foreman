import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteDatabase } from "./database"

const MAGIC = Buffer.from("FOREMAN-BACKUP-V1\n", "utf8")
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024

export type BackupManifest = {
  format: "foreman-sqlite-backup"
  formatVersion: 1
  createdAt: string
  schemaVersion: number
  databaseBytes: number
  sha256: string
}

export type InspectedBackup = { manifest: BackupManifest; database: Buffer }

export class BackupArchiveError extends Error {
  constructor(message: string) { super(message); this.name = "BackupArchiveError" }
}

export async function createBackupArchive(database: SqliteDatabase): Promise<Buffer> {
  const directory = mkdtempSync(join(tmpdir(), "foreman-backup-"))
  const snapshotPath = join(directory, "snapshot.sqlite")
  try {
    await database.connection.backup(snapshotPath)
    const sanitized = new SqliteDatabase(snapshotPath)
    try {
      sanitized.transaction(() => sanitized.connection.prepare("DELETE FROM runtime_connection_settings").run())
      sanitized.connection.exec("VACUUM")
      sanitized.connection.pragma("wal_checkpoint(TRUNCATE)")
    } finally { sanitized.close() }
    const snapshot = readFileSync(snapshotPath)
    const validationPath = join(directory, "validation.sqlite")
    writeFileSync(validationPath, snapshot)
    const validation = new SqliteDatabase(validationPath, { readonly: true })
    try {
      if (validation.schemaVersion() !== database.schemaVersion()) throw new BackupArchiveError("Database schema changed while creating the backup")
      const integrity = validation.connection.pragma("integrity_check") as Array<{ integrity_check: string }>
      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new BackupArchiveError("Backup database failed its integrity check")
    } finally { validation.close() }
    const manifest: BackupManifest = {
      format: "foreman-sqlite-backup",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      schemaVersion: database.schemaVersion(),
      databaseBytes: snapshot.byteLength,
      sha256: createHash("sha256").update(snapshot).digest("hex"),
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8")
    const archive = Buffer.concat([MAGIC, Buffer.from(`${manifestBytes.byteLength}\n`, "ascii"), manifestBytes, snapshot])
    if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new BackupArchiveError("Backup exceeds the 256 MB safety limit")
    return archive
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

export function inspectBackupArchive(archive: Buffer, expectedSchemaVersion: number): InspectedBackup {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new BackupArchiveError("Backup exceeds the 256 MB safety limit")
  if (archive.byteLength < MAGIC.byteLength + 2 || !archive.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new BackupArchiveError("This file is not a supported Foreman backup")
  }
  const lengthEnd = archive.indexOf(0x0a, MAGIC.byteLength)
  if (lengthEnd < 0 || lengthEnd - MAGIC.byteLength > 10) throw new BackupArchiveError("Backup manifest header is invalid")
  const lengthText = archive.subarray(MAGIC.byteLength, lengthEnd).toString("ascii")
  if (!/^\d{1,9}$/.test(lengthText)) throw new BackupArchiveError("Backup manifest length is invalid")
  const manifestLength = Number(lengthText)
  const manifestStart = lengthEnd + 1
  const databaseStart = manifestStart + manifestLength
  if (!Number.isSafeInteger(manifestLength) || manifestLength < 2 || databaseStart >= archive.byteLength) {
    throw new BackupArchiveError("Backup manifest is truncated")
  }
  let manifest: unknown
  try { manifest = JSON.parse(archive.subarray(manifestStart, databaseStart).toString("utf8")) }
  catch { throw new BackupArchiveError("Backup manifest is not valid JSON") }
  if (!manifest || typeof manifest !== "object") throw new BackupArchiveError("Backup manifest is invalid")
  const value = manifest as Partial<BackupManifest>
  if (value.format !== "foreman-sqlite-backup" || value.formatVersion !== 1
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isSafeInteger(value.schemaVersion) || typeof value.databaseBytes !== "number"
    || !Number.isSafeInteger(value.databaseBytes) || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new BackupArchiveError("Backup manifest fields are invalid")
  if (value.schemaVersion !== expectedSchemaVersion) throw new BackupArchiveError(`Backup schema version ${value.schemaVersion} is incompatible with this Foreman version (${expectedSchemaVersion})`)
  const database = archive.subarray(databaseStart)
  if (database.byteLength !== value.databaseBytes) throw new BackupArchiveError("Backup database size does not match its manifest")
  const digest = createHash("sha256").update(database).digest("hex")
  if (digest !== value.sha256) throw new BackupArchiveError("Backup checksum verification failed; the file may be corrupted")
  return { manifest: value as BackupManifest, database }
}

export function stageBackupDatabase(databaseBytes: Buffer): { path: string; cleanup(): void } {
  const directory = mkdtempSync(join(tmpdir(), `foreman-restore-${randomUUID()}-`))
  const path = join(directory, "restore.sqlite")
  writeFileSync(path, databaseBytes, { flag: "wx" })
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}
