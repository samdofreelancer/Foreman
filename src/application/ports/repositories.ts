import type { ActivityEvent } from "../../domain/activity"
import type { Project } from "../../domain/project"
import type { Task } from "../../domain/task"

export interface TaskRepository {
  create(task: Task): void
  getById(id: string): Task | undefined
  list(): Task[]
  update(task: Task): void
  delete(id: string): boolean
  /** Atomically links a previously unlinked task to one session. */
  claimSession(taskId: string, sessionId: string, now: number): boolean
}

export interface ProjectRepository {
  create(project: Project): void
  getById(id: string): Project | undefined
  getByDirectory(directory: string): Project | undefined
  list(): Project[]
  update(project: Project): void
  delete(id: string): boolean
}

export interface ActivityRepository {
  append(event: ActivityEvent): void
  listForTask(taskId: string): ActivityEvent[]
  listRecent(limit: number): ActivityEvent[]
}

export interface TransactionRunner {
  transaction<T>(operation: () => T): T
}
