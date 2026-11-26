import { Schema } from "effect"
import { Store } from "@opencode/plugin/gui"
import { Task } from "./domain/task"

export const stores = {
  tasks: Store.global(Schema.Array(Task), []),
}
