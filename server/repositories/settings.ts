// The settings document (workspace, workflow, roles, localisation, security…). It is a deeply nested configuration tree
// that is always read and replaced as a whole, so it is stored as one validated JSON document. Every request needs it
// (permissions, workflow, time zone), so the parsed copy is cached and dropped if the transaction that changed it rolls back.
import type { Database } from './base'

/** Settings are shared by every request; freezing them turns an accidental in-place edit into an immediate error. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as object)) deepFreeze(child)
  }
  return value
}

export class SettingsRepository {
  private cache: any | null = null
  constructor(private db: Database) {}

  get(): any {
    if (this.cache) return this.cache
    const row = this.db.get<{ document: string }>('SELECT document FROM settings WHERE id = 1')
    this.cache = deepFreeze(row ? JSON.parse(row.document) : {})
    return this.cache
  }

  save(document: unknown) {
    this.db.run(
      'INSERT INTO settings(id, document, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at',
      [JSON.stringify(document), new Date().toISOString()]
    )
    this.cache = deepFreeze(structuredClone(document))
    this.db.onRollback(() => this.invalidate())
  }

  invalidate() {
    this.cache = null
  }
}
