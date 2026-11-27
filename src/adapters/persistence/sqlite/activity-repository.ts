import type { ActivityRepository } from "../../../application/ports/repositories"
import type { ActivityEvent } from "../../../domain/activity"
import { createActivityEvent } from "../../../domain/activity"
import { SqliteDatabase } from "./database"

type ActivityRow = {
  id: string; type: string; summary: string; task_id: string | null; project_id: string | null
  metadata_json: string; occurred_at: number
}

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  append(event: ActivityEvent) {
    // Re-validate at the persistence boundary; callers cannot smuggle unsafe metadata into the log.
    const safe = createActivityEvent({
      type: event.type,
      summary: event.summary,
      taskId: event.taskId,
      projectId: event.projectId,
      metadata: event.metadata,
    }, event.occurredAt, event.id)
    this.database.connection.prepare(`INSERT INTO activity_events
      (id, type, summary, task_id, project_id, metadata_json, occurred_at)
      VALUES (@id, @type, @summary, @taskId, @projectId, @metadata, @occurredAt)`)
      .run({ id: safe.id, type: safe.type, summary: safe.summary, taskId: safe.taskId ?? null,
        projectId: safe.projectId ?? null, metadata: JSON.stringify(safe.metadata), occurredAt: safe.occurredAt })
  }

  listForTask(taskId: string): ActivityEvent[] {
    return (this.database.connection.prepare("SELECT * FROM activity_events WHERE task_id = ? ORDER BY occurred_at, id").all(taskId) as ActivityRow[]).map(fromRow)
  }

  listRecent(limit: number): ActivityEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Activity limit must be an integer between 1 and 500")
    return (this.database.connection.prepare("SELECT * FROM activity_events ORDER BY occurred_at DESC, id DESC LIMIT ?").all(limit) as ActivityRow[]).map(fromRow)
  }
}

function fromRow(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    taskId: row.task_id ?? undefined,
    projectId: row.project_id ?? undefined,
    metadata: JSON.parse(row.metadata_json),
    occurredAt: row.occurred_at,
  }
}
