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
  {
    version: 2,
    name: "task-execution-claims-and-prompt-state",
    up(database) {
      database.exec(`
        ALTER TABLE tasks ADD COLUMN initial_prompt_state TEXT
          CHECK(initial_prompt_state IS NULL OR initial_prompt_state IN ('pending', 'sent', 'failed'));
        CREATE TABLE task_start_claims (
          task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          claim_token TEXT NOT NULL UNIQUE,
          claimed_at INTEGER NOT NULL CHECK(claimed_at >= 0)
        );
      `)
    },
  },
  {
    version: 3,
    name: "runtime-connection-settings",
    up(database) {
      database.exec(`
        CREATE TABLE runtime_connection_settings (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          mode TEXT NOT NULL CHECK(mode IN ('managed', 'external')),
          endpoint TEXT,
          executable TEXT,
          username TEXT,
          secret_ref TEXT,
          credential_required INTEGER NOT NULL DEFAULT 0 CHECK(credential_required IN (0, 1)),
          auto_connect INTEGER NOT NULL DEFAULT 0 CHECK(auto_connect IN (0, 1)),
          updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
          CHECK((mode = 'managed' AND endpoint IS NULL) OR (mode = 'external' AND endpoint IS NOT NULL))
        );
      `)
    },
  },
]
