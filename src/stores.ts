import { Schema } from "effect"
import { Task } from "./domain/task"

export const stores = {
  tasks: {
    Store: "global",
    schema: Schema.Array(Task),
    initial: [] as Array<typeof Task.Type>,
  },
}
