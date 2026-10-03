// Tags: labels a person puts on tasks. Names are unique ignoring case; deleting a tag removes it from every task (foreign keys).
import { type Database, type Row, marks } from './base'

export interface Tag {
  id: string
  name: string
  color: string
}
export interface TagUsage extends Tag {
  tasks: number
}
const toTag = (row: Row): Tag => ({ id: row.id, name: row.name, color: row.color })

export class TagRepository {
  constructor(private db: Database) {}

  list(): TagUsage[] {
    return this.db
      .all(
        `SELECT g.id, g.name, g.color, count(tt.task_id) AS tasks FROM tags g LEFT JOIN task_tags tt ON tt.tag_id = g.id
         GROUP BY g.id ORDER BY lower(g.name)`
      )
      .map(row => ({ ...toTag(row), tasks: Number(row.tasks) }))
  }
  byId(id: string): Tag | undefined {
    const row = this.db.get('SELECT * FROM tags WHERE id = ?', [id])
    return row && toTag(row)
  }
  byName(name: string): Tag | undefined {
    const row = this.db.get('SELECT * FROM tags WHERE lower(name) = lower(?)', [name.trim()])
    return row && toTag(row)
  }
  insert(tag: Tag) {
    this.db.run('INSERT INTO tags(id, name, color, created_at) VALUES (?, ?, ?, ?)', [
      tag.id,
      tag.name.trim(),
      tag.color,
      new Date().toISOString()
    ])
  }
  update(id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) {
    if (patch.name !== undefined) this.db.run('UPDATE tags SET name = ? WHERE id = ?', [patch.name.trim(), id])
    if (patch.color !== undefined) this.db.run('UPDATE tags SET color = ? WHERE id = ?', [patch.color, id])
  }
  delete(id: string) {
    this.db.run('DELETE FROM tags WHERE id = ?', [id])
  }

  /** Tags of the given tasks, in name order (one query per 500 tasks). */
  forTasks(taskIds: number[]): Map<number, Tag[]> {
    const map = new Map<number, Tag[]>()
    for (let i = 0; i < taskIds.length; i += 500) {
      const chunk = taskIds.slice(i, i + 500)
      for (const row of this.db.all<{ task_id: number } & Row>(
        `SELECT tt.task_id, g.id, g.name, g.color FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
         WHERE tt.task_id IN (${marks(chunk.length)}) ORDER BY lower(g.name)`,
        chunk
      )) {
        const list = map.get(Number(row.task_id))
        const tag = toTag(row)
        if (list) list.push(tag)
        else map.set(Number(row.task_id), [tag])
      }
    }
    return map
  }
  tagIdsOf(taskId: number): string[] {
    return this.db
      .all<{ tag_id: string }>('SELECT tag_id FROM task_tags WHERE task_id = ?', [taskId])
      .map(row => row.tag_id)
  }
  /** Replace a task's tags with exactly these. */
  setForTask(taskId: number, tagIds: string[]) {
    this.db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId])
    for (const id of new Set(tagIds)) this.db.run('INSERT INTO task_tags(task_id, tag_id) VALUES (?, ?)', [taskId, id])
  }
  add(taskId: number, tagId: string): boolean {
    return this.db.run('INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES (?, ?)', [taskId, tagId]).changes > 0
  }
  remove(taskId: number, tagId: string): boolean {
    return this.db.run('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?', [taskId, tagId]).changes > 0
  }
}
