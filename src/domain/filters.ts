import type { Task } from "./task"

export function applyFilter(tasks: Task[], projectDirectory?: string): Task[] {
  if (!projectDirectory) return [...tasks]
  return tasks.filter((task) => task.projectDirectory === projectDirectory)
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...tasks]
  return tasks.filter((task) => task.title.toLocaleLowerCase().includes(normalized))
}

export function applyTaskFilters(
  tasks: Task[],
  projectDirectory?: string,
  query = "",
): Task[] {
  return searchTasks(applyFilter(tasks, projectDirectory), query)
}

export function isProjectMissing(
  projectDirectory: string,
  knownProjectDirectories: readonly string[],
): boolean {
  return !knownProjectDirectories.includes(projectDirectory)
}
