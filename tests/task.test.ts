import { describe, expect, it } from "vitest"
import {
  clearTaskFinished,
  createTask,
  deleteTask,
  markTaskStarted,
  markTaskStartFailed,
  safeTaskArray,
  setTaskFinished,
  updateTask,
  validateTaskInput,
} from "../src/domain/task"

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

  it("keeps Doing transitions under runtime control even for linked tasks", () => {
    const task = createTask({ title: "Runtime", projectDirectory: "/projects/foreman" }, 100, "task-runtime")
    const started = markTaskStarted(task, "ses-runtime", 200)
    expect(() => updateTask(started, { column: "ready" }, 300)).toThrow(/managed by runs/i)
    expect(() => updateTask(started, { column: "done" }, 300)).toThrow(/managed by runs/i)
    expect(() => updateTask(task, { column: "doing" }, 200)).toThrow(/managed by runs/i)
  })

  it("guards an unexpected store value and resets it to an empty array", () => {
    expect(safeTaskArray(undefined)).toEqual([])
    expect(safeTaskArray({ not: "an array" })).toEqual([])
  })

  it("marks a task started exactly once", () => {
    const task = createTask(
      { title: "Run", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    const started = markTaskStarted(task, "ses-1", 200)
    expect(started.sessionID).toBe("ses-1")
    expect(started.startedAt).toBe(200)
    expect(started.column).toBe("doing")
    expect(markTaskStarted(started, "ses-2", 300).sessionID).toBe("ses-1")
  })

  it("restores the previous column and records a readable start error", () => {
    const task = createTask(
      { title: "Run", projectDirectory: "/projects/foreman", column: "ready" },
      100,
      "task-1",
    )
    const failed = markTaskStartFailed(task, "todo", "Sidecar unavailable", 200)
    expect(failed.column).toBe("todo")
    expect(failed.lastError).toBe("Sidecar unavailable")
  })

  it("sets and clears finishedAt only for Done transitions", () => {
    const task = createTask(
      { title: "Run", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    const done = setTaskFinished(task, 200)
    expect(done.finishedAt).toBe(200)
    expect(done.column).toBe("done")
    expect(clearTaskFinished(done, "todo", 300).finishedAt).toBeUndefined()
  })

  it("does not replace an existing sessionID through updateTask", () => {
    const task = createTask(
      { title: "Run", projectDirectory: "/projects/foreman" },
      100,
      "task-1",
    )
    const started = markTaskStarted(task, "ses-1", 200)
    const updated = updateTask(started, { sessionID: "ses-replacement" } as never, 300)
    expect(updated.sessionID).toBe("ses-1")
  })

  it("rejects timestamps that move backwards", () => {
    const task = createTask({ title: "Clock", projectDirectory: "/projects/foreman" }, 100, "task-1")
    expect(() => updateTask(task, { title: "Older" }, 99)).toThrow(/timestamp/i)
    expect(() => createTask({ title: "Bad", projectDirectory: "/projects/foreman" }, -1, "task-2")).toThrow(/timestamp/i)
    expect(() => updateTask(task, { title: " " }, 101)).toThrow(/title/i)
    expect(() => setTaskFinished(task, 99)).toThrow(/timestamp/i)
  })
})
