import { describe, expect, it } from "vitest"
import { normalizeRoute, routeTitle, routes } from "../src/ui/routes"

describe("standalone UI route model", () => {
  it("normalizes the root route to the Board and preserves supported routes", () => {
    expect(normalizeRoute("/")).toBe("/board")
    expect(normalizeRoute("/projects")).toBe("/projects")
    expect(normalizeRoute("/inbox")).toBe("/inbox")
    expect(normalizeRoute("/activity")).toBe("/activity")
    expect(normalizeRoute("/settings")).toBe("/settings")
  })

  it("falls back to the Board for unknown paths and provides stable navigation labels", () => {
    expect(normalizeRoute("/not-a-route")).toBe("/board")
    expect(routeTitle("/board")).toBe("Board")
    expect(routeTitle("/settings")).toBe("Settings")
    expect(routes.map((route) => route.path)).toEqual(["/board", "/projects", "/inbox", "/activity"])
  })
})
