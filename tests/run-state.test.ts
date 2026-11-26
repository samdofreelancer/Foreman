import { describe, expect, it } from "vitest"
import { deriveRunState } from "../src/domain/run-state"

describe("deriveRunState", () => {
  it("returns working while busy is newer than idle", () => {
    expect(deriveRunState({
      present: true,
      busy: 20,
      idle: 10,
      viewed: 5,
    })).toBe("working")
  })

  it("returns unread when idle is at or after viewed", () => {
    expect(deriveRunState({
      present: true,
      busy: undefined,
      idle: 20,
      viewed: 10,
    })).toBe("unread")
  })

  it("returns reviewed otherwise", () => {
    expect(deriveRunState({
      present: true,
      busy: undefined,
      idle: 10,
      viewed: 20,
    })).toBe("reviewed")
  })

  it("returns missing when session info is absent", () => {
    expect(deriveRunState({ present: false })).toBe("missing")
  })
})
