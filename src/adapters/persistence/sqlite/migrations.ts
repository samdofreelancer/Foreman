import type Database from "better-sqlite3"

export type Migration = { version: number; name: string; up: (database: Database.Database) => void }

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial-foreman-domain",
    up(database) {
      database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
          directory TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL CHECK(created_at >= 0),
          updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
          description TEXT,
          project_directory TEXT NOT NULL,
          project_name TEXT,
          agent TEXT,
          model_json TEXT,
          column_name TEXT NOT NULL CHECK(column_name IN ('todo', 'ready', 'doing', 'done')),
          session_id TEXT UNIQUE,
          created_at INTEGER NOT NULL CHECK(created_at >= 0),
          updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
          started_at INTEGER,
          finished_at INTEGER,
          last_error TEXT,
          CHECK(column_name != 'doing' OR session_id IS NOT NULL)
        );
        CREATE INDEX tasks_project_directory_idx ON tasks(project_directory);
        CREATE INDEX tasks_column_updated_idx ON tasks(column_name, updated_at DESC);
        CREATE TRIGGER tasks_session_id_immutable
        BEFORE UPDATE OF session_id ON tasks
        WHEN OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id
        BEGIN
          SELECT RAISE(ABORT, 'task session id is immutable');
        END;
        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL CHECK(length(trim(type)) BETWEEN 1 AND 100),
          summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 500),
          task_id TEXT,
          project_id TEXT,
          metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
          occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0)
        );
        CREATE INDEX activity_task_time_idx ON activity_events(task_id, occurred_at DESC);
        CREATE INDEX activity_time_idx ON activity_events(occurred_at DESC);
        CREATE TRIGGER activity_events_append_only_update
        BEFORE UPDATE ON activity_events
        BEGIN
          SELECT RAISE(ABORT, 'activity events are append-only');
        END;
        CREATE TRIGGER activity_events_append_only_delete
        BEFORE DELETE ON activity_events
        BEGIN
          SELECT RAISE(ABORT, 'activity events are append-only');
        END;
      `)
    },
  },
]
