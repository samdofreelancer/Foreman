import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix, resolve, win32 } from "node:path"
import { SqliteDatabase } from "../adapters/persistence/sqlite/database"

export type ForemanBootstrap = {
  databasePath: string
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

  return {
    databasePath,
    health: () => database
      ? { status: "ready", schemaVersion: database.schemaVersion() }
      : { status: "degraded", schemaVersion: 0, message: failureMessage },
    close: () => database?.close(),
  }
}
