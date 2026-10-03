function parseFilters(value) {
  if (value === null || value === undefined) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeLanguage(value) {
  return typeof value === 'string' ? value : ''
}

export class UserPreferencesRepository {
  constructor(db) {
    this.getStatement = db.prepare('SELECT filters_json, language_code FROM user_preferences WHERE user_id = ?')
    this.saveStatement = db.prepare(`
      INSERT INTO user_preferences(user_id, filters_json, language_code, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        filters_json = excluded.filters_json,
        language_code = excluded.language_code,
        updated_at = excluded.updated_at
    `)
  }

  getPreferences(userId) {
    const row = this.getStatement.get(String(userId))
    return {
      filters: parseFilters(row?.filters_json),
      language: normalizeLanguage(row?.language_code)
    }
  }

  savePreferences(userId, preferences = {}) {
    const current = this.getPreferences(userId)
    const filters = Object.hasOwn(preferences, 'filters') ? preferences.filters : current.filters
    const language = Object.hasOwn(preferences, 'language') ? normalizeLanguage(preferences.language) : current.language
    this.saveStatement.run(String(userId), JSON.stringify(filters || {}), language, new Date().toISOString())
    return this.getPreferences(userId)
  }

  getFilters(userId) {
    return this.getPreferences(userId).filters
  }

  saveFilters(userId, filters) {
    return this.savePreferences(userId, { filters }).filters
  }
}
