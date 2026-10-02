// Built-in translation data, shared by the client (rendering) and the server (so that only
// *administrator overrides* are ever persisted, never a frozen copy of the built-in catalog).
import CORE from './core-catalog.json'
import PHRASES from './ui-phrases.json'

export type Catalog = Record<string, Record<string, string>>

export const CORE_I18N_TRANSLATIONS = CORE as Catalog
export const UI_I18N_PHRASES = PHRASES as Catalog
export const UI_I18N_SOURCES: string[] = Object.keys(UI_I18N_PHRASES.en || {})
export const BUILTIN_LANGUAGES = ['en', 'ar', 'fa', 'he']
export const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ur']

export function uiPhraseKey(value = ''): string {
  return `ui.${String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`
}

let cached: Catalog | null = null
/** The complete built-in catalog: core keys + one `ui.*` key per UI phrase, for each built-in language. */
export function buildTranslationCatalog(): Catalog {
  if (cached) return cached
  cached = Object.fromEntries(
    BUILTIN_LANGUAGES.map(lang => [
      lang,
      {
        ...(CORE_I18N_TRANSLATIONS[lang] || {}),
        ...Object.fromEntries(
          UI_I18N_SOURCES.map(source => [
            uiPhraseKey(source),
            (lang === 'en' ? source : UI_I18N_PHRASES[lang]?.[source]) || source
          ])
        )
      }
    ])
  )
  return cached
}

/** Keep only the entries that differ from the built-in catalog (what an administrator actually changed). */
export function stripBuiltinTranslations(translations: unknown): Catalog {
  const builtin = buildTranslationCatalog()
  const out: Catalog = {}
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return out
  for (const [lang, catalog] of Object.entries(translations as Record<string, unknown>)) {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) continue
    const overrides: Record<string, string> = {}
    for (const [key, value] of Object.entries(catalog as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      if (builtin[lang]?.[key] === value) continue
      overrides[key] = value
    }
    if (Object.keys(overrides).length || !(lang in builtin)) out[lang] = overrides
  }
  return out
}
