import type { SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import { Board } from "./Board"

export function BoardPage(props: { ctx: SetupContext<typeof definition> }) {
  return (
    <props.ctx.ui.SettingsLayout
      title={props.ctx.t("board.title")}
      description="Todo / Ready / Doing / Done"
    >
      <Board ctx={props.ctx} />
    </props.ctx.ui.SettingsLayout>
  )
}
