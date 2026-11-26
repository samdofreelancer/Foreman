import { describe, expect, it } from "vitest"
import { applyTaskFilters, isProjectMissing } from "../src/domain/filters"

const tasks = [
  { id: "1", title: "Fix login", projectDirectory: "/a", column: "todo" as const, createdAt: 1, updatedAt: 1 },
  { id: "2", title: "Add login tests", projectDirectory: "/b", column: "ready" as const, createdAt: 1, updatedAt: 1 },
  { id: "3", title: "Build dashboard", projectDirectory: "/a", column: "done" as const, createdAt: 1, updatedAt: 1 },
]

describe("filter domain", () => {
  it("filters by project", () => {
    expect(applyTaskFilters(tasks, "/a", "").map((task) => task.id)).toEqual(["1", "3"])
  })

  it("searches partial titles case-insensitively", () => {
    expect(applyTaskFilters(tasks, undefined, "LOGIN").map((task) => task.id)).toEqual(["1", "2"])
  })

  it("combines project and search", () => {
    expect(applyTaskFilters(tasks, "/a", "login").map((task) => task.id)).toEqual(["1"])
  })

  it("returns no cards for no match", () => {
    expect(applyTaskFilters(tasks, "/c", "")).toEqual([])
  })

  it("detects a task whose project directory is missing", () => {
    expect(isProjectMissing("/projects/a", ["/projects/a", "/projects/b"])).toBe(false)
    expect(isProjectMissing("/projects/c", ["/projects/a", "/projects/b"])).toBe(true)
  })
})
