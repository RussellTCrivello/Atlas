function parseFilters(value) {
  if (value === null || value === undefined) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export class UserPreferencesRepository {
  constructor(db) {
    this.getStatement = db.prepare('SELECT filters_json FROM user_preferences WHERE user_id = ?')
    this.saveStatement = db.prepare(`
      INSERT INTO user_preferences(user_id, filters_json, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET filters_json = excluded.filters_json, updated_at = excluded.updated_at
    `)
  }

  getFilters(userId) {
    const row = this.getStatement.get(String(userId))
    return parseFilters(row?.filters_json)
  }

  saveFilters(userId, filters) {
    this.saveStatement.run(String(userId), JSON.stringify(filters), new Date().toISOString())
    return this.getFilters(userId)
  }
}
