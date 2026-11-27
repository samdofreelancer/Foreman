import { describe, expect, it } from "vitest"
import { createActivityEvent, validateActivityInput } from "../src/domain/activity"

describe("activity domain", () => {
  it("creates a structured activity event without changing its identity or timestamp", () => {
    const event = createActivityEvent({
      type: "task.created",
      summary: "Task created",
      taskId: "task-1",
      metadata: { source: "foreman", attempt: 1, tags: ["local", "task"] },
    }, 100, "activity-1")

    expect(event).toEqual({
      id: "activity-1",
      type: "task.created",
      summary: "Task created",
      taskId: "task-1",
      metadata: { source: "foreman", attempt: 1, tags: ["local", "task"] },
      occurredAt: 100,
    })
  })

  it("rejects transcript, prompt, credential, and secret metadata fields", () => {
    for (const key of ["transcript", "prompt", "apiToken", "password", "authorization"]) {
      expect(validateActivityInput({
        type: "task.updated",
        summary: "Updated",
        metadata: { [key]: "sensitive" },
      }).valid).toBe(false)
    }
  })

  it("rejects unsupported nested metadata and empty summaries", () => {
    expect(validateActivityInput({
      type: "task.updated",
      summary: " ",
      metadata: { nested: { deeper: { value: "x" } } },
    }).valid).toBe(false)
    expect(validateActivityInput({
      type: "task.updated",
      summary: "Updated",
      metadata: { a: { b: { c: { d: { e: "too deep" } } } } },
    }).valid).toBe(false)
    expect(validateActivityInput({ type: "task.updated", summary: "ok", metadata: { bad: () => 1 } }).valid).toBe(false)
  })
})
