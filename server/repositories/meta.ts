// Single-value facts about the database: the data revision, whether first-run setup is done, the audit anchor.
import type { Database } from './base'

export class MetaRepository {
  constructor(private db: Database) {}

  get(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value
  }
  set(key: string, value: string) {
    this.db.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      value
    ])
  }
  /** Advances on every committed write; clients poll it to learn that something changed. */
  revision(): number {
    return this.db.revision
  }
  configured(): boolean {
    return this.get('configured') === '1'
  }
  setConfigured(value: boolean) {
    this.set('configured', value ? '1' : '0')
  }
  createdAt(): string {
    return this.get('created_at') || ''
  }
  updatedAt(): string {
    return this.get('updated_at') || ''
  }
  auditAnchor(): string {
    return this.get('audit_anchor') || ''
  }
  setAuditAnchor(hash: string) {
    this.set('audit_anchor', hash)
  }
  legacyImport(): { at: string; source: string; counts: Record<string, number>; repairs: string[] } | null {
    const raw = this.get('legacy_import')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
}
