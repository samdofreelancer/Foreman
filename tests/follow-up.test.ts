import { describe, expect, it } from "vitest"
import { buildFollowUpInput } from "../src/gui/run/follow-up"

describe("buildFollowUpInput", () => {
  it("rejects empty follow-ups", () => {
    expect(buildFollowUpInput("ses-1", "   ", false)).toBeUndefined()
  })

  it("uses queue delivery while working", () => {
    expect(buildFollowUpInput("ses-1", "Add tests", true)).toEqual({
      sessionID: "ses-1",
      text: "Add tests",
      delivery: "queue",
    })
  })

  it("uses no delivery hint when idle", () => {
    expect(buildFollowUpInput("ses-1", "Add tests", false)).toEqual({
      sessionID: "ses-1",
      text: "Add tests",
    })
  })
})
