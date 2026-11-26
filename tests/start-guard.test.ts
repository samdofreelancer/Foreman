import { describe, expect, it } from "vitest"
import { canStart } from "../src/domain/start-guard"
import type { Task } from "../src/domain/task"

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Run",
    projectDirectory: "/projects/foreman",
    column: "ready",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe("canStart", () => {
  it("allows a ready task with no session and an absolute project", () => {
    expect(canStart(task(), new Set())).toEqual({ valid: true })
  })

  it("rejects an existing session", () => {
    expect(canStart(task({ sessionID: "ses-1" }), new Set()).reason).toBe("session-linked")
  })

  it("rejects a task already starting", () => {
    expect(canStart(task(), new Set(["task-1"])).reason).toBe("already-starting")
  })

  it("rejects a task outside Ready", () => {
    expect(canStart(task({ column: "todo" }), new Set()).reason).toBe("wrong-column")
  })

  it("rejects missing or relative project directories", () => {
    expect(canStart(task({ projectDirectory: "" }), new Set()).reason).toBe("missing-directory")
    expect(canStart(task({ projectDirectory: "relative" }), new Set()).reason).toBe("missing-directory")
  })
})
