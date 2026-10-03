// Full-text search for the command palette: tasks and projects through SQLite FTS5 (prefix match, accent-insensitive),
// people through a plain LIKE (a short table that needs no index).
import { type Database, ftsQuery, likeEscape } from './base'

export interface SearchHit {
  kind: 'task' | 'project' | 'person'
  id: string | number
  title: string
  detail: string
  /** Where the result lives, for the browser to navigate to. */
  link: string
}

export class SearchRepository {
  constructor(private db: Database) {}

  search(text: string, limit = 8): SearchHit[] {
    const query = text.trim()
    if (!query) return []
    const fts = ftsQuery(query)
    const like = `%${likeEscape(query)}%`
    const hits: SearchHit[] = []
    if (fts) {
      for (const row of this.db.all(
        `SELECT t.id, t.key, t.title, t.status, t.project_id, p.name AS project_name
         FROM task_search s JOIN tasks t ON t.id = s.rowid JOIN projects p ON p.id = t.project_id
         WHERE task_search MATCH ? ORDER BY rank LIMIT ?`,
        [fts, limit]
      ))
        hits.push({
          kind: 'task',
          id: Number(row.id),
          title: `${row.key} · ${row.title}`,
          detail: `${row.project_name} · ${row.status}`,
          link: `/projects/${row.project_id}?task=${row.id}`
        })
      for (const row of this.db.all(
        `SELECT p.id, p.code, p.name, p.status FROM project_search s JOIN projects p ON p.id = s.rowid
         WHERE project_search MATCH ? ORDER BY rank LIMIT ?`,
        [fts, limit]
      ))
        hits.push({
          kind: 'project',
          id: Number(row.id),
          title: `${row.name}`,
          detail: `${row.code} · ${row.status}`,
          link: `/projects/${row.id}`
        })
    }
    for (const row of this.db.all(
      "SELECT id, name, email, job_title FROM people WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?",
      [like, like, like, limit]
    ))
      hits.push({
        kind: 'person',
        id: String(row.id),
        title: String(row.name),
        detail: String(row.job_title || row.email || ''),
        link: '/people'
      })
    return hits
  }
}
