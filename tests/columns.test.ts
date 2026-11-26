import { describe, expect, it } from "vitest"
import { columnCounts, groupTasks, orderColumn } from "../src/domain/columns"

describe("column domain", () => {
  it("orders tasks by updated time descending and id ascending", () => {
    const tasks = [
      { id: "b", title: "B", projectDirectory: "/b", column: "todo" as const, createdAt: 1, updatedAt: 10 },
      { id: "a", title: "A", projectDirectory: "/a", column: "todo" as const, createdAt: 1, updatedAt: 10 },
      { id: "c", title: "C", projectDirectory: "/c", column: "todo" as const, createdAt: 1, updatedAt: 20 },
    ]
    expect(orderColumn(tasks).map((task) => task.id)).toEqual(["c", "a", "b"])
  })

  it("groups and counts all four columns", () => {
    const tasks = [
      { id: "1", title: "Todo", projectDirectory: "/a", column: "todo" as const, createdAt: 1, updatedAt: 1 },
      { id: "2", title: "Ready", projectDirectory: "/a", column: "ready" as const, createdAt: 1, updatedAt: 1 },
      { id: "3", title: "Doing", projectDirectory: "/a", column: "doing" as const, createdAt: 1, updatedAt: 1 },
      { id: "4", title: "Done", projectDirectory: "/a", column: "done" as const, createdAt: 1, updatedAt: 1 },
    ]
    expect(Object.keys(groupTasks(tasks))).toEqual(["todo", "ready", "doing", "done"])
    expect(columnCounts(tasks)).toEqual({ todo: 1, ready: 1, doing: 1, done: 1 })
  })

  it("allows duplicate titles as distinct stable cards", () => {
    const tasks = [
      { id: "1", title: "Same", projectDirectory: "/a", column: "todo" as const, createdAt: 1, updatedAt: 1 },
      { id: "2", title: "Same", projectDirectory: "/b", column: "todo" as const, createdAt: 1, updatedAt: 1 },
    ]
    expect(orderColumn(tasks).map((task) => task.id)).toEqual(["1", "2"])
  })
})
