export type Project = Readonly<{
  id: string
  name: string
  directory: string
  createdAt: number
  updatedAt: number
}>

export type ProjectInput = {
  name: string
  directory: string
}

export type ProjectPatch = Partial<Pick<Project, "name" | "directory">>

export function validateProjectInput(input: ProjectInput) {
  const name = input.name.trim()
  const directory = input.directory.trim()
  const nameError = name.length === 0 ? "Project name is required" : name.length > 120 ? "Project name must be 120 characters or fewer" : undefined
  const directoryError = directory.length === 0
    ? "Project directory is required"
    : !isAbsolutePath(directory) ? "Project directory must be absolute" : undefined

  return { valid: !nameError && !directoryError, nameError, directoryError }
}

export function createProject(input: ProjectInput, now: number, id: string): Project {
  const validation = validateProjectInput(input)
  if (!validation.valid) throw new Error(validation.nameError ?? validation.directoryError)
  if (!id.trim()) throw new Error("Project id is required")
  if (!Number.isFinite(now) || now < 0) throw new Error("Project timestamp must be a non-negative finite number")
  return { id, name: input.name.trim(), directory: input.directory.trim(), createdAt: now, updatedAt: now }
}

export function updateProject(existing: Project, patch: ProjectPatch, now: number): Project {
  if (!Number.isFinite(now) || now < existing.updatedAt) throw new Error("Project timestamp cannot move backwards")
  const next = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: now }
  const validation = validateProjectInput({ name: next.name, directory: next.directory })
  if (!validation.valid) throw new Error(validation.nameError ?? validation.directoryError)
  return { ...next, name: next.name.trim(), directory: next.directory.trim() }
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
}
