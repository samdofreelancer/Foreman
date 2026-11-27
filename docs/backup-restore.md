# Foreman backup and restore

Foreman creates a single-file `.fbackup` archive containing an online SQLite snapshot,
a versioned manifest, the schema version, database byte length, and a SHA-256 checksum.
The snapshot is checked with SQLite `integrity_check` before it is offered for download.

## Backup

1. Open **Settings → Backup & restore**.
2. Choose **Download backup**. OpenCode does not need to be installed or running.
3. Store the downloaded `.fbackup` file somewhere separate from the computer running
   Foreman. The archive is a user-owned data file; protect it accordingly.

The archive includes Foreman tasks, projects, activity, and the schema migration ledger.
Runtime connection settings are deliberately cleared before export, including endpoint,
username, auto-connect state, and OS-vault references. OpenCode credentials, provider
secrets, and OpenCode session transcripts are not exported.

## Restore

1. Stop or disconnect OpenCode execution. Foreman refuses restore while the runtime is
   connected/stale or a task is still in **Doing**.
2. Open **Settings → Backup & restore** and select the `.fbackup` file.
3. Foreman validates the archive format, manifest, checksum, exact supported schema,
   SQLite integrity, expected Foreman database objects, and required tables. It then shows
   the archive timestamp and task/project/activity counts. Preview does not change the
   active database.
4. Choose **Confirm restore** and acknowledge the warning. Foreman closes the SQLite
   connection, makes a rollback copy, and replaces the active database with the validated
   staged database. The database connection is reopened before success is reported.
5. Runtime connection settings are not restored. Configure/reconnect OpenCode separately.

The restore preview expires after ten minutes and is bound to a random one-time token.
Invalid files, unsupported schema versions, checksum failures, unexpected database
objects, and SQLite corruption are rejected before the active database is touched.

## Rollback and recovery

The previous database is retained beside `foreman.sqlite` using a filename similar to
`foreman.sqlite.rollback-<timestamp>-<id>`. Do not delete this file until the restored
workspace has been checked. If activation fails, Foreman attempts to restore and reopen the
previous database automatically; if automatic rollback itself fails, the error identifies
the retained rollback file. Close Foreman before manually replacing the active database.

Foreman keeps the backup archive and rollback copy local. It does not upload either file.
The current release limits backup archives to 256 MB and requires an exact schema-version
match; cross-version migration of backup archives is not supported.
