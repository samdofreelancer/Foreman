import { describe, expect, it } from "vitest"
import { createProject, updateProject, validateProjectInput } from "../src/domain/project"

describe("project domain", () => {
  it("creates a normalized project with immutable identity and timestamps", () => {
    const project = createProject({ name: "  Foreman  ", directory: "C:\\work\\foreman" }, 100, "project-1")

    expect(project).toEqual({
      id: "project-1",
      name: "Foreman",
      directory: "C:\\work\\foreman",
      createdAt: 100,
      updatedAt: 100,
    })
    const updated = updateProject(project, { id: "other", createdAt: 1, name: "Renamed" } as never, 200)
    expect(updated.id).toBe("project-1")
    expect(updated.createdAt).toBe(100)
    expect(updated.updatedAt).toBe(200)
    expect(updated.name).toBe("Renamed")
  })

  it("rejects empty names and non-absolute directories", () => {
    expect(validateProjectInput({ name: " ", directory: "/work/a" }).valid).toBe(false)
    expect(validateProjectInput({ name: "A", directory: "relative/path" }).valid).toBe(false)
  })
})
