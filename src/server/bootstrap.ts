import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix, resolve, win32 } from "node:path"
import { SqliteDatabase } from "../adapters/persistence/sqlite/database"
import { SqliteTaskRepository } from "../adapters/persistence/sqlite/task-repository"
import { SqliteProjectRepository } from "../adapters/persistence/sqlite/project-repository"
import { SqliteActivityRepository } from "../adapters/persistence/sqlite/activity-repository"
import { SqliteRuntimeSettingsRepository } from "../adapters/persistence/sqlite/runtime-settings-repository"
import { ForemanBackupManager } from "../adapters/persistence/sqlite/backup-manager"

export type ForemanBootstrap = {
  databasePath: string
  tasks?: SqliteTaskRepository
  projects?: SqliteProjectRepository
  activities?: SqliteActivityRepository
  runtimeSettings?: SqliteRuntimeSettingsRepository
  backup?: ForemanBackupManager
  transaction<T>(operation: () => T): T
  health(): { status: "ready" | "degraded"; schemaVersion: number; message?: string }
  close(): void
}

export function defaultDataDirectory(options: {
  platform?: NodeJS.Platform
  home?: string
  appData?: string
  xdgDataHome?: string
} = {}): string {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  if (platform === "win32") return win32.resolve(options.appData || win32.join(home, "AppData", "Roaming"), "Foreman")
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "Foreman")
  return posix.join(options.xdgDataHome || posix.join(home, ".local", "share"), "foreman")
}

export function initializeForeman(options: { dataDirectory?: string } = {}): ForemanBootstrap {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.FOREMAN_DATA_DIR ?? defaultDataDirectory())
  const databasePath = join(dataDirectory, "foreman.sqlite")
  let database: SqliteDatabase | undefined
  let failureMessage: string | undefined
  try {
    mkdirSync(dataDirectory, { recursive: true })
    database = new SqliteDatabase(databasePath)
  } catch {
    failureMessage = "Foreman could not safely open its local database. The original data has not been deleted. Close Foreman and restore a valid backup, or choose a new data directory."
  }
  const backup = database ? new ForemanBackupManager(database) : undefined

  return {
    databasePath,
    tasks: database ? new SqliteTaskRepository(database) : undefined,
    projects: database ? new SqliteProjectRepository(database) : undefined,
    activities: database ? new SqliteActivityRepository(database) : undefined,
    runtimeSettings: database ? new SqliteRuntimeSettingsRepository(database) : undefined,
    backup,
    transaction: <T>(operation: () => T) => {
      if (!database) throw new Error("Foreman database is unavailable")
      return database.transaction(operation)
    },
    health: () => database
      ? { status: "ready", schemaVersion: database.schemaVersion() }
      : { status: "degraded", schemaVersion: 0, message: failureMessage },
    close: () => { backup?.close(); database?.close() },
  }
}
