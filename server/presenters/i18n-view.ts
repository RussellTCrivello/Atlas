import { RTL_LANGUAGES, buildTranslationCatalog } from '../../shared/i18n/catalog'

export function translationCatalogPayload(settings: any, language: string | null = null) {
  const localization = settings.localization || {}
  const fallback = localization.fallbackLanguage || 'en'
  const selected =
    language && (localization.activeLanguages || []).includes(language)
      ? language
      : localization.defaultLanguage || fallback || 'en'
  const builtin = buildTranslationCatalog()
  const catalogFor = (lang: string) => ({ ...(builtin[lang] || {}), ...(localization.translations?.[lang] || {}) })
  return {
    language: selected,
    fallbackLanguage: fallback,
    direction: localization.textDirectionByLanguage?.[selected] || (RTL_LANGUAGES.includes(selected) ? 'rtl' : 'ltr'),
    catalog: { ...catalogFor(fallback), ...catalogFor(selected) },
    fallbackCatalog: catalogFor(fallback),
    languages: localization.languagePackages || [],
    activeLanguages: localization.activeLanguages || [],
    interfaces: localization.interfaces || {},
    keyPolicy: localization.keyPolicy || {},
    runtime: localization.runtime || {},
    generatedAt: new Date().toISOString()
  }
}
