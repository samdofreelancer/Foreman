import { describe, expect, it } from "vitest"
import { createTask, deleteTask, updateTask, validateTaskInput } from "../src/domain/task"

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

  it("trims titles and accepts titles up to 200 characters", () => {
    expect(validateTaskInput({ title: "x".repeat(201), projectDirectory: "/projects/a" }).valid).toBe(false)
    expect(validateTaskInput({ title: "  Valid title  ", projectDirectory: "/projects/a" }).valid).toBe(true)
  })

  it("requires an absolute POSIX or Windows project directory", () => {
    expect(validateTaskInput({ title: "Task", projectDirectory: "relative" }).valid).toBe(false)
    expect(validateTaskInput({ title: "Task", projectDirectory: "C:\\work\\foreman" }).valid).toBe(true)
  })

  it("preserves id and createdAt while updating immutable fields are ignored", () => {
    const task = createTask(
      { title: "Original", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    const updated = updateTask(task, { id: "changed", createdAt: 1, title: "Renamed" } as never, 200)
    expect(updated.id).toBe("task-1")
    expect(updated.createdAt).toBe(100)
    expect(updated.title).toBe("Renamed")
  })

  it("deletes only the matching task", () => {
    const tasks = [
      createTask({ title: "One", projectDirectory: "/projects/a" }, 100, "task-1"),
      createTask({ title: "Two", projectDirectory: "/projects/b" }, 100, "task-2"),
    ]
    expect(deleteTask(tasks, "task-1").map((task) => task.id)).toEqual(["task-2"])
  })

  it("rejects manual moves into Doing without a session", () => {
    const task = createTask(
      { title: "Manual", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    expect(() => updateTask(task, { column: "doing" }, 200)).toThrow()
  })
})
