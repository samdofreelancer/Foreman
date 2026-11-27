import type { ProjectRepository } from "../../../application/ports/repositories"
import type { Project } from "../../../domain/project"
import { SqliteDatabase } from "./database"

type ProjectRow = { id: string; name: string; directory: string; created_at: number; updated_at: number }

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(project: Project) {
    this.database.connection.prepare(`INSERT INTO projects(id, name, directory, created_at, updated_at)
      VALUES (@id, @name, @directory, @createdAt, @updatedAt)`).run(toRow(project))
  }

  getById(id: string): Project | undefined {
    const row = this.database.connection.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined
    return row ? fromRow(row) : undefined
  }

  getByDirectory(directory: string): Project | undefined {
    const row = this.database.connection.prepare("SELECT * FROM projects WHERE directory = ?").get(directory) as ProjectRow | undefined
    return row ? fromRow(row) : undefined
  }

  list(): Project[] {
    return (this.database.connection.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE, id").all() as ProjectRow[]).map(fromRow)
  }

  update(project: Project) {
    const result = this.database.connection.prepare(`UPDATE projects SET name=@name, directory=@directory,
      updated_at=@updatedAt WHERE id=@id AND created_at=@createdAt`).run(toRow(project))
    if (result.changes !== 1) throw new Error(`Project not found or immutable fields changed: ${project.id}`)
  }

  delete(id: string): boolean {
    return this.database.connection.prepare("DELETE FROM projects WHERE id = ?").run(id).changes === 1
  }
}

function toRow(project: Project) {
  return { id: project.id, name: project.name, directory: project.directory, createdAt: project.createdAt, updatedAt: project.updatedAt }
}

function fromRow(row: ProjectRow): Project {
  return { id: row.id, name: row.name, directory: row.directory, createdAt: row.created_at, updatedAt: row.updated_at }
}
