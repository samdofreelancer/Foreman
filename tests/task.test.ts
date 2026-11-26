import { describe, expect, it } from "vitest"
import { createTask, updateTask, validateTaskInput } from "../src/domain/task"

describe("task domain", () => {
  it("creates a Todo task from title and project", () => {
    const task = createTask(
      { title: "  Add board  ", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    expect(task.title).toBe("Add board")
    expect(task.projectDirectory).toBe("/projects/foreman")
    expect(task.column).toBe("todo")
  })

  it("sets and clears finishedAt on column changes", () => {
    const task = createTask(
      { title: "Ship", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    const done = updateTask(task, { column: "done" }, 200)
    expect(done.finishedAt).toBe(200)
    const reopened = updateTask(done, { column: "todo" }, 300)
    expect(reopened.finishedAt).toBeUndefined()
  })

  it("rejects empty title and project", () => {
    expect(validateTaskInput({ title: "", projectDirectory: "" }).valid).toBe(false)
  })
})
