import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { defaultDataDirectory, initializeForeman } from "../src/server/bootstrap"

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "foreman-bootstrap-"))
  directories.push(directory)
  return directory
}

describe("standalone application bootstrap", () => {
  it("selects an application-owned data directory for each supported OS", () => {
    expect(defaultDataDirectory({ platform: "win32", home: "C:/Users/test", appData: "C:/Users/test/AppData/Roaming" })).toBe("C:\\Users\\test\\AppData\\Roaming\\Foreman")
    expect(defaultDataDirectory({ platform: "darwin", home: "/Users/test" })).toBe("/Users/test/Library/Application Support/Foreman")
    expect(defaultDataDirectory({ platform: "linux", home: "/home/test", xdgDataHome: "/home/test/.local/share" })).toBe("/home/test/.local/share/foreman")
  })

  it("creates and migrates a first-run database, then closes it with the app lifecycle", () => {
    const directory = join(temporaryDirectory(), "nested", "data")
    const app = initializeForeman({ dataDirectory: directory })
    expect(app.databasePath).toBe(join(directory, "foreman.sqlite"))
    expect(app.health()).toEqual({ status: "ready", schemaVersion: 3 })
    app.close()
  })

  it("enters a safe degraded state for a corrupt database without deleting the original", () => {
    const directory = temporaryDirectory()
    mkdirSync(directory, { recursive: true })
    const databasePath = join(directory, "foreman.sqlite")
    writeFileSync(databasePath, "not a sqlite database")
    const app = initializeForeman({ dataDirectory: directory })
    expect(app.health()).toMatchObject({ status: "degraded", schemaVersion: 0 })
    expect(app.health().message).toContain("original data has not been deleted")
    app.close()
  })
})
