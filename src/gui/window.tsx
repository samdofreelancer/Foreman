import {
  Command,
  SettingsPage,
  Style,
  type SetupContext,
} from "@opencode/plugin/gui"
import type { definition } from "./definition"
import { BoardPage } from "./board/BoardPage"
import { boardStyles } from "./board/styles"

export function setup(ctx: SetupContext<typeof definition>) {
  ctx.add(Style, boardStyles)
  ctx.add(SettingsPage, {
    id: "foreman",
    icon: "grid-plus",
    get title() {
      return ctx.t("board.title")
    },
    render: () => <BoardPage ctx={ctx} />,
  })
  ctx.add(Command, {
    id: "open-board",
    bind: "mod+shift+b",
    section: "navigation",
    get title() {
      return ctx.t("board.title")
    },
    run: () => ctx.layout.settings("foreman"),
  })
}
