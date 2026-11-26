import type { Task } from "./task"

export function applyFilter(tasks: Task[], projectDirectory?: string): Task[] {
  if (!projectDirectory) return [...tasks]
  const normalizedDirectory = normalizeProjectDirectory(projectDirectory)
  return tasks.filter((task) =>
    normalizeProjectDirectory(task.projectDirectory) === normalizedDirectory,
  )
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
  const normalizedDirectory = normalizeProjectDirectory(projectDirectory)
  return !knownProjectDirectories.some(
    (directory) => normalizeProjectDirectory(directory) === normalizedDirectory,
  )
}

export function normalizeProjectDirectory(directory: string): string {
  return directory.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLocaleLowerCase()
}

export function reconcileProjectFilter(
  selected: string | undefined,
  tasks: readonly Task[],
): string | undefined {
  if (!selected) return undefined
  return tasks.some((task) =>
    normalizeProjectDirectory(task.projectDirectory) === normalizeProjectDirectory(selected),
  ) ? selected : undefined
}
