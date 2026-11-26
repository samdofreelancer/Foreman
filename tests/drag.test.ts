import { describe, expect, it } from "vitest"
import { resolveDrop } from "../src/domain/drag"

describe("resolveDrop", () => {
  it("starts a task dropped on Ready", () => {
    expect(resolveDrop({ taskID: "task-1", from: "todo" }, "ready")).toEqual({
      kind: "start",
      taskID: "task-1",
    })
  })

  it("rejects drops on Doing", () => {
    expect(resolveDrop({ taskID: "task-1", from: "todo" }, "doing")).toEqual({
      kind: "reject",
      reason: "managed",
    })
  })

  it("rejects same-column and outside drops", () => {
    expect(resolveDrop({ taskID: "task-1", from: "todo" }, "todo").kind).toBe("reject")
    expect(resolveDrop({ taskID: "task-1", from: "todo" }, undefined).kind).toBe("reject")
  })

  it("moves ordinary drops between columns", () => {
    expect(resolveDrop({ taskID: "task-1", from: "todo" }, "done")).toEqual({
      kind: "move",
      taskID: "task-1",
      to: "done",
    })
  })
})
