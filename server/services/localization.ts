// Translations: the built-in catalogue plus whatever an administrator adds, registers or imports. All of it lives in the
// settings document; this service is the only writer of its `localization` branch.
import { buildTranslationCatalog } from '../../shared/i18n/catalog'
import { compactSettingsForStorage, normalizeSettings } from '../../shared/settings'
import type { AuditContext } from '../domain/audit-chain'
import { translationCatalogPayload } from '../presenters/i18n-view'
import { truncate } from '../util'
import type { I18nBulkInput, I18nRegisterInput, I18nTranslationInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'

/** Runtime log of translation keys the UI could not resolve. Diagnostic only: kept in memory, bounded, never persisted. */
export class MissingKeyLog {
  private rows = new Map<
    string,
    {
      key: string
      language: string
      fallback: string
      source: string
      count: number
      firstSeenAt: string
      lastSeenAt: string
    }
  >()
  constructor(private cap = 200) {}
  add(input: { key: string; language: string; fallback?: string; source?: string }) {
    const key = `${input.language}:${input.key}`
    const now = new Date().toISOString()
    const existing = this.rows.get(key)
    if (existing) {
      existing.count++
      existing.lastSeenAt = now
      return
    }
    if (this.rows.size >= this.cap) return
    this.rows.set(key, {
      key: truncate(input.key, 200),
      language: truncate(input.language, 20),
      fallback: truncate(input.fallback || '', 300),
      source: truncate(input.source || 'runtime', 60),
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now
    })
  }
  list() {
    return [...this.rows.values()].map(row => ({ ...row, status: 'missing' }))
  }
  clear() {
    this.rows.clear()
  }
}

export class LocalizationService {
  readonly missingKeys = new MissingKeyLog()

  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  catalog(language: string | null = null) {
    return translationCatalogPayload(this.ctx.settings, language)
  }

  /** Which keys each active language still lacks, compared with the fallback language. */
  missingTranslations() {
    const localization = this.ctx.settings.localization || {}
    const builtin = buildTranslationCatalog()
    const catalogFor = (lang: string) => ({ ...(builtin[lang] || {}), ...(localization.translations?.[lang] || {}) })
    const fallback = localization.fallbackLanguage || 'en'
    const base = Object.keys(catalogFor(fallback))
    const missing = Object.fromEntries(
      (localization.activeLanguages || []).map((lang: string) => [lang, base.filter(key => !catalogFor(lang)[key])])
    )
    const totalMissing = Object.values(missing).reduce((sum: number, rows: any) => sum + rows.length, 0)
    return { fallback, keys: base, missing, totalMissing, byLanguage: missing }
  }

  /** The browser reports a key it could not translate. Ignored when the administrator turned reporting off. */
  reportMissing(input: { key: string; language?: string; fallback?: string; source?: string }) {
    const localization = this.ctx.settings.localization || {}
    if (localization.runtime?.reportMissing === false) return { ok: true, ignored: true }
    this.missingKeys.add({
      key: input.key,
      language: input.language || localization.defaultLanguage || 'en',
      fallback: input.fallback,
      source: input.source
    })
    return { ok: true }
  }

  private mergeCatalogs(settings: any, resources: Record<string, Record<string, string>>) {
    const localization = settings.localization
    localization.translations = localization.translations || {}
    for (const [language, catalog] of Object.entries(resources)) {
      localization.translations[language] = { ...(localization.translations[language] || {}), ...catalog }
      if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language)
    }
  }

  /** Edit a copy of the settings, store the normalised result, and return it. */
  private edit(change: (draft: any) => void) {
    const draft = structuredClone(this.ctx.settings)
    change(draft)
    this.ctx.repos.settings.save(
      compactSettingsForStorage(normalizeSettings(draft, { timezone: this.ctx.config.defaultTimezone }))
    )
  }

  register(userId: string, body: I18nRegisterInput, who: AuditContext) {
    const namespace = body.namespace.replace(/[^a-zA-Z0-9_.-]+/g, '_')
    const translations = (body.translations || {}) as Record<string, Record<string, string>>
    const metadata = body.metadata || {}
    this.ctx.transaction(() => {
      this.edit(draft => {
        const localization = draft.localization
        this.mergeCatalogs(draft, translations)
        const fallbackLanguage = localization.fallbackLanguage || 'en'
        localization.interfaces = {
          ...(localization.interfaces || {}),
          [namespace]: {
            namespace,
            label: metadata.label || namespace,
            version: metadata.version || '1.0.0',
            owner: metadata.owner || 'custom',
            status: metadata.status || 'active',
            route: metadata.route || '',
            registeredAt: new Date().toISOString(),
            keys: Object.keys(translations[fallbackLanguage] || translations.en || {})
          }
        }
        localization.translationMemory = [
          ...(localization.translationMemory || []),
          {
            namespace,
            action: 'registered',
            languages: Object.keys(translations),
            userId,
            at: new Date().toISOString()
          }
        ]
      })
      this.audit.record('i18n.interface.registered', who, { namespace, languages: Object.keys(translations) })
    })
    return { ok: true, namespace, catalog: this.catalog() }
  }

  setTranslation(body: I18nTranslationInput, who: AuditContext) {
    const value = body.value ?? ''
    const status = body.status || 'approved'
    this.ctx.transaction(() => {
      this.edit(draft => {
        this.mergeCatalogs(draft, { [body.language]: { [body.key]: value } })
        const localization = draft.localization
        localization.approvalWorkflow = localization.approvalWorkflow || { enabled: true, statusByKey: {} }
        localization.approvalWorkflow.statusByKey = {
          ...(localization.approvalWorkflow.statusByKey || {}),
          [body.key]: status
        }
      })
      this.audit.record('i18n.translation.updated', who, { language: body.language, key: body.key, status })
    })
    this.missingKeys.clear()
    return { ok: true, language: body.language, key: body.key, value, status }
  }

  bulkImport(userId: string, body: I18nBulkInput, who: AuditContext) {
    const resources = (body.translations || body.resources || {}) as Record<string, Record<string, string>>
    this.ctx.transaction(() => {
      this.edit(draft => {
        this.mergeCatalogs(draft, resources)
        draft.localization.translationMemory = [
          ...(draft.localization.translationMemory || []),
          { action: 'bulk-import', languages: Object.keys(resources), userId, at: new Date().toISOString() }
        ]
      })
      this.audit.record('i18n.bulk.imported', who, { languages: Object.keys(resources) })
    })
    return { ok: true, catalog: this.catalog() }
  }
}
