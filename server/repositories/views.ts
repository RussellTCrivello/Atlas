// Saved views: a person's named table settings for one screen. Private by default; an administrator can share one with everybody.
import { type Database, type Row, isOne } from './base'

export interface SavedView {
  id: string
  userId: string
  scope: string
  name: string
  config: Record<string, unknown>
  shared: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}
const toView = (row: Row): SavedView => ({
  id: row.id,
  userId: row.user_id,
  scope: row.scope,
  name: row.name,
  config: JSON.parse(row.config),
  shared: isOne(row.shared),
  isDefault: isOne(row.is_default),
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export class ViewRepository {
  constructor(private db: Database) {}

  /** The person's own views plus the ones shared with everybody, own first. */
  visibleTo(userId: string, scope: string): SavedView[] {
    return this.db
      .all(
        'SELECT * FROM saved_views WHERE scope = ? AND (user_id = ? OR shared = 1) ORDER BY (user_id = ?) DESC, lower(name)',
        [scope, userId, userId]
      )
      .map(toView)
  }
  byId(id: string): SavedView | undefined {
    const row = this.db.get('SELECT * FROM saved_views WHERE id = ?', [id])
    return row && toView(row)
  }
  nameTaken(userId: string, scope: string, name: string, exceptId?: string): boolean {
    return Boolean(
      this.db.get(
        'SELECT 1 FROM saved_views WHERE user_id = ? AND scope = ? AND lower(name) = lower(?) AND id IS NOT ?',
        [userId, scope, name.trim(), exceptId ?? null]
      )
    )
  }
  insert(view: SavedView) {
    this.db.run(
      'INSERT INTO saved_views(id, user_id, scope, name, config, shared, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        view.id,
        view.userId,
        view.scope,
        view.name.trim(),
        JSON.stringify(view.config),
        view.shared,
        view.isDefault,
        view.createdAt,
        view.updatedAt
      ]
    )
  }
  update(
    id: string,
    patch: { name?: string; config?: Record<string, unknown>; shared?: boolean; isDefault?: boolean }
  ) {
    const now = new Date().toISOString()
    if (patch.name !== undefined)
      this.db.run('UPDATE saved_views SET name = ?, updated_at = ? WHERE id = ?', [patch.name.trim(), now, id])
    if (patch.config !== undefined)
      this.db.run('UPDATE saved_views SET config = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(patch.config),
        now,
        id
      ])
    if (patch.shared !== undefined)
      this.db.run('UPDATE saved_views SET shared = ?, updated_at = ? WHERE id = ?', [patch.shared, now, id])
    if (patch.isDefault !== undefined)
      this.db.run('UPDATE saved_views SET is_default = ?, updated_at = ? WHERE id = ?', [patch.isDefault, now, id])
  }
  countFor(userId: string, scope: string): number {
    return Number(this.db.scalar('SELECT count(*) FROM saved_views WHERE user_id = ? AND scope = ?', [userId, scope]))
  }
  /** At most one default per person and screen. */
  clearDefault(userId: string, scope: string) {
    this.db.run('UPDATE saved_views SET is_default = 0 WHERE user_id = ? AND scope = ? AND is_default = 1', [
      userId,
      scope
    ])
  }
  delete(id: string) {
    this.db.run('DELETE FROM saved_views WHERE id = ?', [id])
  }
}
