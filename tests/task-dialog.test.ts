import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("task dialog host integration", () => {
  it("renders through the host Dialog frame instead of a raw overlay form", () => {
    const source = readFileSync(
      new URL("../src/gui/board/TaskDialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("ctx.ui.Dialog")
    expect(source).not.toContain('<form\n      class="foreman-dialog"')
  })
})
