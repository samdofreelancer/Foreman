import type { Task, TaskColumn } from "./task"

export type TaskColumnGroup = Record<TaskColumn, Task[]>

export function orderColumn(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt
    }
    return left.id.localeCompare(right.id)
  })
}

export function groupTasks(tasks: Task[]): TaskColumnGroup {
  return {
    todo: orderColumn(tasks.filter((task) => task.column === "todo")),
    ready: orderColumn(tasks.filter((task) => task.column === "ready")),
    doing: orderColumn(tasks.filter((task) => task.column === "doing")),
    done: orderColumn(tasks.filter((task) => task.column === "done")),
  }
}

export function columnCounts(tasks: Task[]): Record<TaskColumn, number> {
  const groups = groupTasks(tasks)
  return {
    todo: groups.todo.length,
    ready: groups.ready.length,
    doing: groups.doing.length,
    done: groups.done.length,
  }
}
