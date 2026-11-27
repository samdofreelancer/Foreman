import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTask } from "../src/domain/task"
import { SqliteDatabase } from "../src/adapters/persistence/sqlite/database"
import { SqliteTaskRepository } from "../src/adapters/persistence/sqlite/task-repository"
import { SqliteRuntimeSettingsRepository } from "../src/adapters/persistence/sqlite/runtime-settings-repository"
import { createBackupArchive, inspectBackupArchive } from "../src/adapters/persistence/sqlite/backup-archive"
import { ForemanBackupManager } from "../src/adapters/persistence/sqlite/backup-manager"

const directories: string[] = []
const databases: SqliteDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close() } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "foreman-backup-test-"))
  directories.push(directory)
  const database = new SqliteDatabase(join(directory, "foreman.sqlite"))
  databases.push(database)
  const tasks = new SqliteTaskRepository(database)
  const settings = new SqliteRuntimeSettingsRepository(database)
  const manager = new ForemanBackupManager(database)
  return { directory, database, tasks, settings, manager }
}

function addTask(tasks: SqliteTaskRepository, id: string, title: string) {
  tasks.create(createTask({ title, projectDirectory: `C:/work/${id}` }, Date.now(), id))
}

describe("Foreman backup and restore", () => {
  it("creates a valid online SQLite archive with a manifest and checksum", async () => {
    const f = fixture()
    addTask(f.tasks, "task-a", "Alpha")
    const archive = await createBackupArchive(f.database)
    const inspected = inspectBackupArchive(archive, 3)
    expect(inspected.manifest).toMatchObject({ format: "foreman-sqlite-backup", formatVersion: 1, schemaVersion: 3 })
    expect(inspected.database.byteLength).toBeGreaterThan(0)
    expect(inspected.manifest.databaseBytes).toBe(inspected.database.byteLength)
  })

  it("rejects invalid manifests, unsupported schema versions, and checksum corruption", async () => {
    const f = fixture()
    const archive = await createBackupArchive(f.database)
    expect(() => inspectBackupArchive(Buffer.from("not a backup"), 3)).toThrow(/not a supported/i)
    expect(() => inspectBackupArchive(archive, 2)).toThrow(/schema version 3 is incompatible/i)
    const corrupted = Buffer.from(archive)
    corrupted[corrupted.length - 1] ^= 0xff
    expect(() => inspectBackupArchive(corrupted, 3)).toThrow(/checksum/i)
  })

  it("rejects an archive whose manifest JSON is malformed", async () => {
    const f = fixture()
    const archive = await createBackupArchive(f.database)
    const marker = Buffer.from("FOREMAN-BACKUP-V1\n")
    const lengthEnd = archive.indexOf(0x0a, marker.length)
    const length = Number(archive.subarray(marker.length, lengthEnd).toString("ascii"))
    const malformed = Buffer.from("{")
    const header = Buffer.concat([marker, Buffer.from(`${malformed.length}\n`), malformed, archive.subarray(lengthEnd + 1 + length)])
    expect(() => inspectBackupArchive(header, 3)).toThrow(/manifest/i)
  })

  it("rejects a corrupt SQLite database even when the archive checksum is internally consistent", async () => {
    const f = fixture()
    const valid = await createBackupArchive(f.database)
    const marker = Buffer.from("FOREMAN-BACKUP-V1\n")
    const lengthEnd = valid.indexOf(0x0a, marker.length)
    const manifestLength = Number(valid.subarray(marker.length, lengthEnd).toString("ascii"))
    const original = JSON.parse(valid.subarray(lengthEnd + 1, lengthEnd + 1 + manifestLength).toString("utf8")) as Record<string, unknown>
    const corruptedDatabase = Buffer.from(valid.subarray(lengthEnd + 1 + manifestLength))
    corruptedDatabase[0] = 0
    const manifest = Buffer.from(JSON.stringify({ ...original, databaseBytes: corruptedDatabase.byteLength, sha256: createHash("sha256").update(corruptedDatabase).digest("hex") }))
    const corruptedArchive = Buffer.concat([marker, Buffer.from(`${manifest.byteLength}\n`), manifest, corruptedDatabase])
    expect(() => f.manager.previewRestore(corruptedArchive)).toThrow()
    expect(f.database.health().status).toBe("ready")
  })

  it("excludes saved runtime connection settings and OS-vault references from exported data", async () => {
    const f = fixture()
    addTask(f.tasks, "task-private", "Private task")
    f.settings.save({ mode: "external", endpoint: "https://private.example.test", username: "operator", secretRef: "vault-ref-sensitive", credentialRequired: false, autoConnect: true, updatedAt: Date.now() })
    const archive = await createBackupArchive(f.database)
    const inspected = inspectBackupArchive(archive, 3)
    const staged = join(f.directory, "inspect.sqlite")
    writeFileSync(staged, inspected.database)
    const restored = new SqliteDatabase(staged, { readonly: true })
    try {
      expect(new SqliteTaskRepository(restored).list()).toHaveLength(1)
      expect(new SqliteRuntimeSettingsRepository(restored).get()).toBeUndefined()
      expect(inspected.database.toString("latin1")).not.toContain("vault-ref-sensitive")
      expect(inspected.database.toString("latin1")).not.toContain("private.example.test")
    } finally { restored.close() }
  })

  it("previews task counts and requires an explicit token before replacing current data", async () => {
    const source = fixture()
    addTask(source.tasks, "source-task", "From backup")
    const archive = await source.manager.createBackup()
    const target = fixture()
    addTask(target.tasks, "target-task", "Current data")
    const preview = target.manager.previewRestore(archive)
    expect(preview.counts).toEqual({ tasks: 1, projects: 0, activities: 0 })
    expect(target.tasks.list().map((task) => task.id)).toEqual(["target-task"])
    expect(() => target.manager.confirmRestore("wrong-token")).toThrow(/token does not match/i)
    const result = target.manager.confirmRestore(preview.token)
    expect(result).toMatchObject({ restored: true, rollbackAvailable: true })
    expect(target.tasks.list().map((task) => task.id)).toEqual(["source-task"])
  })

  it("retains a rollback copy and restores the original database when activation fails", () => {
    const f = fixture()
    addTask(f.tasks, "keep-me", "Must survive")
    const invalid = join(f.directory, "corrupt.sqlite")
    writeFileSync(invalid, "not sqlite")
    expect(() => f.database.replaceFromFile(invalid)).toThrow()
    expect(f.tasks.list().map((task) => task.id)).toEqual(["keep-me"])
    expect(f.database.health()).toMatchObject({ status: "ready", schemaVersion: 3 })
  })

  it("keeps the successful restore rollback file on disk", async () => {
    const source = fixture()
    addTask(source.tasks, "restored", "Restored")
    const archive = await source.manager.createBackup()
    const target = fixture()
    addTask(target.tasks, "old", "Old")
    const preview = target.manager.previewRestore(archive)
    const result = target.manager.confirmRestore(preview.token)
    expect(result.rollbackAvailable).toBe(true)
    const rollbackFiles = (await import("node:fs")).readdirSync(target.directory).filter((name) => name.includes("rollback-"))
    expect(rollbackFiles).toHaveLength(1)
    expect(existsSync(join(target.directory, rollbackFiles[0]))).toBe(true)
  })
})
