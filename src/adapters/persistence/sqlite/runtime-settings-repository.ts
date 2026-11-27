import type { RuntimeConnectionSettings, RuntimeSettingsRepository } from "../../../application/ports/repositories"
import { SqliteDatabase } from "./database"

type RuntimeSettingsRow = {
  mode: "managed" | "external"
  endpoint: string | null
  executable: string | null
  username: string | null
  secret_ref: string | null
  credential_required: number
  auto_connect: number
  updated_at: number
}

/** Stores connection metadata only. Credentials must remain in SecretStore, never SQLite. */
export class SqliteRuntimeSettingsRepository implements RuntimeSettingsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  get(): RuntimeConnectionSettings | undefined {
    const row = this.database.connection.prepare("SELECT * FROM runtime_connection_settings WHERE id = 1").get() as RuntimeSettingsRow | undefined
    if (!row) return undefined
    return {
      mode: row.mode,
      ...(row.endpoint ? { endpoint: row.endpoint } : {}),
      ...(row.executable ? { executable: row.executable } : {}),
      ...(row.username ? { username: row.username } : {}),
      ...(row.secret_ref ? { secretRef: row.secret_ref } : {}),
      credentialRequired: row.credential_required === 1,
      autoConnect: row.auto_connect === 1,
      updatedAt: row.updated_at,
    }
  }

  save(settings: RuntimeConnectionSettings): void {
    if (settings.mode === "external" && !settings.endpoint) throw new Error("External runtime settings require an endpoint")
    this.database.connection.prepare(`INSERT INTO runtime_connection_settings
      (id, mode, endpoint, executable, username, secret_ref, credential_required, auto_connect, updated_at)
      VALUES (1, @mode, @endpoint, @executable, @username, @secretRef, @credentialRequired, @autoConnect, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, endpoint=excluded.endpoint,
        executable=excluded.executable, username=excluded.username, secret_ref=excluded.secret_ref,
        credential_required=excluded.credential_required, auto_connect=excluded.auto_connect,
        updated_at=excluded.updated_at`).run({
      mode: settings.mode,
      endpoint: settings.endpoint ?? null,
      executable: settings.executable ?? null,
      username: settings.username ?? null,
      secretRef: settings.secretRef ?? null,
      credentialRequired: settings.credentialRequired ? 1 : 0,
      autoConnect: settings.autoConnect ? 1 : 0,
      updatedAt: settings.updatedAt,
    })
  }
}
