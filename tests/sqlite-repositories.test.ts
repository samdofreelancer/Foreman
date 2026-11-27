import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { createTask } from "../src/domain/task"
import { createProject } from "../src/domain/project"
import { DatabaseStartupError, SqliteDatabase } from "../src/adapters/persistence/sqlite/database"
import { SqliteTaskRepository } from "../src/adapters/persistence/sqlite/task-repository"
import { SqliteProjectRepository } from "../src/adapters/persistence/sqlite/project-repository"
import { SqliteActivityRepository } from "../src/adapters/persistence/sqlite/activity-repository"
import { createActivityEvent } from "../src/domain/activity"

const directories: string[] = []
const databases: SqliteDatabase[] = []
function database() {
  const directory = mkdtempSync(join(tmpdir(), "foreman-phase1-"))
  directories.push(directory)
  const db = new SqliteDatabase(join(directory, "foreman.sqlite"))
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("SQLite persistence", () => {
  it("migrates an empty database and persists tasks, projects, and safe activity", () => {
    const db = database()
    const tasks = new SqliteTaskRepository(db)
    const projects = new SqliteProjectRepository(db)
    const activities = new SqliteActivityRepository(db)
    const project = createProject({ name: "Foreman", directory: "/work/foreman" }, 10, "project-1")
    const task = createTask({ title: "Build domain", projectDirectory: project.directory }, 20, "task-1")
    const activity = createActivityEvent({ type: "task.created", summary: "Task created", taskId: task.id }, 30, "activity-1")

    projects.create(project)
    tasks.create(task)
    activities.append(activity)

    expect(db.schemaVersion()).toBe(2)
    expect(projects.getById(project.id)).toEqual(project)
    expect(tasks.getById(task.id)).toEqual(task)
    expect(activities.listForTask(task.id)).toEqual([activity])
    expect(activities.listRecent(10)).toEqual([activity])
    expect(() => db.connection.prepare("UPDATE activity_events SET summary = 'rewritten' WHERE id = ?").run(activity.id))
      .toThrow(/append-only/i)
    expect(() => db.connection.prepare("DELETE FROM activity_events WHERE id = ?").run(activity.id))
      .toThrow(/append-only/i)
    db.close()
  })

  it("updates and deletes records without changing immutable task identity", () => {
    const db = database()
    const tasks = new SqliteTaskRepository(db)
    const projects = new SqliteProjectRepository(db)
    const task = createTask({ title: "Original", projectDirectory: "/work/a" }, 1, "task-1")
    const project = createProject({ name: "Original", directory: "/work/a" }, 1, "project-1")
    tasks.create(task)
    projects.create(project)

    tasks.update({ ...task, title: "Updated", updatedAt: 2 })
    projects.update({ ...project, name: "Updated", updatedAt: 2 })
    expect(tasks.getById(task.id)?.title).toBe("Updated")
    expect(projects.getById(project.id)?.name).toBe("Updated")
    expect(tasks.delete(task.id)).toBe(true)
    expect(projects.delete(project.id)).toBe(true)
    expect(tasks.delete(task.id)).toBe(false)
    db.close()
  })

  it("enforces a unique session id across tasks and immutable task session links", async () => {
    const db = database()
    const tasks = new SqliteTaskRepository(db)
    const first = createTask({ title: "One", projectDirectory: "/work/a", column: "ready" }, 1, "task-1")
    const second = createTask({ title: "Two", projectDirectory: "/work/b", column: "ready" }, 1, "task-2")
    tasks.create(first)
    tasks.create(second)

    const secondConnection = new SqliteDatabase(db.path)
    databases.push(secondConnection)
    const secondConnectionTasks = new SqliteTaskRepository(secondConnection)
    expect(tasks.claimStart(first.id, "claim-a", 2)).toBe(true)
    expect(secondConnectionTasks.claimStart(second.id, "claim-b", 2)).toBe(true)
    const claims = await Promise.all([
      Promise.resolve().then(() => tasks.claimSession(first.id, "ses-1", 3, "claim-a")),
      Promise.resolve().then(() => secondConnectionTasks.claimSession(second.id, "ses-1", 3, "claim-b")),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = claims[0] ? first : second
    const loser = claims[0] ? second : first
    expect(tasks.claimSession(winner.id, "ses-2", 4, "claim-retry")).toBe(false)
    expect(tasks.getById(winner.id)?.sessionID).toBe("ses-1")
    expect(tasks.getById(loser.id)?.sessionID).toBeUndefined()
    expect(() => db.connection.prepare("UPDATE tasks SET session_id = ? WHERE id = ?").run("ses-replacement", winner.id))
      .toThrow(/immutable/i)
    expect(tasks.getById(first.id)?.sessionID).toBe("ses-1")
    expect(tasks.getById(second.id)?.sessionID).toBeUndefined()
    db.close()
  })

  it("atomically reserves a Ready task before creating a session and persists the initial-prompt state", () => {
    const db = database()
    const tasks = new SqliteTaskRepository(db)
    const task = createTask({ title: "Reserved", projectDirectory: "/work/reserved", column: "ready" }, 1, "task-reserved")
    tasks.create(task)
    const secondConnection = new SqliteDatabase(db.path)
    databases.push(secondConnection)
    const otherTasks = new SqliteTaskRepository(secondConnection)

    expect(tasks.claimStart(task.id, "claim-a", 2)).toBe(true)
    expect(otherTasks.claimStart(task.id, "claim-b", 3)).toBe(false)
    expect(otherTasks.getById(task.id)?.startPending).toBe(true)
    expect(tasks.claimSession(task.id, "ses-reserved", 4, "claim-a")).toBe(true)
    expect(otherTasks.getById(task.id)).toMatchObject({ column: "doing", sessionID: "ses-reserved", initialPromptState: "pending" })
    expect(otherTasks.getById(task.id)?.startPending).toBeUndefined()
    tasks.setInitialPromptState(task.id, "failed", "Prompt rejected", 5)
    expect(tasks.getById(task.id)).toMatchObject({ initialPromptState: "failed", lastError: "Prompt rejected" })
    expect(tasks.claimStart(task.id, "claim-c", 6)).toBe(false)
  })

  it("releases a failed pre-session claim without linking a session", () => {
    const db = database()
    const tasks = new SqliteTaskRepository(db)
    const task = createTask({ title: "Retryable", projectDirectory: "/work/retryable", column: "ready" }, 1, "task-retry")
    tasks.create(task)
    expect(tasks.claimStart(task.id, "claim-a", 2)).toBe(true)
    expect(tasks.releaseStart(task.id, "claim-a", "Server unavailable", 3)).toBe(true)
    expect(tasks.getById(task.id)).toMatchObject({ column: "ready", lastError: "Server unavailable" })
    expect(tasks.getById(task.id)?.startPending).toBeUndefined()
    expect(tasks.claimStart(task.id, "claim-b", 4)).toBe(true)
  })

  it("rolls back all writes when a transaction fails", () => {
    const db = database()
    const projects = new SqliteProjectRepository(db)
    const project = createProject({ name: "Rollback", directory: "/work/rollback" }, 1, "project-1")

    expect(() => db.transaction(() => {
      projects.create(project)
      throw new Error("abort")
    })).toThrow("abort")
    expect(projects.getById(project.id)).toBeUndefined()
    db.close()
  })

  it("rolls back a failed schema migration and leaves the migration ledger unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "foreman-migration-failure-"))
    directories.push(directory)
    const path = join(directory, "migration.sqlite")
    const setup = new Database(path)
    setup.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
      CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations
      BEGIN SELECT RAISE(ABORT, 'migration intentionally blocked'); END;
    `)
    setup.close()

    try {
      new SqliteDatabase(path)
      throw new Error("Expected migration to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseStartupError)
      expect((error as DatabaseStartupError).diagnosticMessage).toMatch(/intentionally blocked/i)
    }

    const verify = new Database(path, { readonly: true })
    expect(verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get()).toBeUndefined()
    expect(verify.prepare("SELECT version FROM schema_migrations").all()).toEqual([])
    verify.close()
  })

  it("reports a corrupt database as a recoverable startup error", () => {
    const directory = mkdtempSync(join(tmpdir(), "foreman-corrupt-"))
    directories.push(directory)
    const path = join(directory, "corrupt.sqlite")
    writeFileSync(path, "not a sqlite database")
    expect(() => new SqliteDatabase(path)).toThrow(DatabaseStartupError)
  })

  it("opens a migrated database in read-only mode without changing its schema", () => {
    const db = database()
    const path = db.path
    expect(db.schemaVersion()).toBe(2)
    db.close()
    const readOnly = new SqliteDatabase(path, { readonly: true })
    databases.push(readOnly)
    expect(readOnly.health()).toEqual({ status: "ready", schemaVersion: 2 })
    expect(() => readOnly.transaction(() => 1)).toThrow()
    readOnly.close()
  })

  it("refuses a database schema created by a newer Foreman version", () => {
    const directory = mkdtempSync(join(tmpdir(), "foreman-future-schema-"))
    directories.push(directory)
    const path = join(directory, "future.sqlite")
    const connection = new Database(path)
    connection.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)")
    connection.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (99, 'future', 1)").run()
    connection.close()

    try {
      new SqliteDatabase(path)
      throw new Error("Expected unsupported schema version to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseStartupError)
      expect((error as DatabaseStartupError).diagnosticMessage).toMatch(/newer than this Foreman build supports/i)
    }
  })
})
