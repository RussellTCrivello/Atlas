// UI localisation runtime.
//
// The interface is written in English and a DOM localiser swaps phrases for the active language. Three rules keep that safe:
//  1. User-entered data is never rewritten. Any text that equals a value present in the loaded workspace data (task titles,
//     project and people names, activity text, ...) is left alone, as is anything inside [translate="no"] / [data-no-i18n].
//  2. Each text node remembers the English source it was rendered from, so switching language re-translates from the source
//     (the old runtime reverse-mapped translated text back to English, which also rewrote user data in the English UI).
//  3. Work is incremental: only nodes React actually mutated are revisited; English needs no work at all.
import { useEffect, useMemo, useRef } from 'react'
import {
  RTL_LANGUAGES,
  UI_I18N_PHRASES,
  UI_I18N_SOURCES,
  buildTranslationCatalog,
  uiPhraseKey
} from '../../shared/i18n/catalog'
import { api } from './api'

export { buildTranslationCatalog, uiPhraseKey }

export function uiLanguage(settings: any): string {
  return settings?.localization?.defaultLanguage || settings?.language || 'en'
}
export function textDirection(settings: any): 'ltr' | 'rtl' {
  const lang = uiLanguage(settings)
  return settings?.localization?.textDirectionByLanguage?.[lang] || (RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr')
}
export function interpolateMessage(template: unknown = '', values: Record<string, any> = {}): string {
  return String(template ?? '').replace(/\{\{?\s*([\w.-]+)\s*\}?\}/g, (_, key) => values?.[key] ?? '')
}

// ---- phrase translation --------------------------------------------------------------------------------------------
export interface Translator {
  lang: string
  translate(text: string): string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')

export function buildTranslator(settings: any): Translator {
  const lang = uiLanguage(settings)
  // English text *is* the source: nothing to translate (and therefore nothing that could ever rewrite user data).
  if (lang === 'en') return { lang, translate: text => text }
  const catalog = settings?.localization?.translations?.[lang] || {}
  const direct = UI_I18N_PHRASES[lang] || {}
  const map = new Map<string, string>()
  for (const source of UI_I18N_SOURCES) map.set(source, catalog[uiPhraseKey(source)] || direct[source] || source)
  // Longer phrases embedded in dynamic text ("Showing 3 of 9 tasks"), longest first so the most specific one wins.
  const long = UI_I18N_SOURCES.filter(source => source.length > 10).sort((a, b) => b.length - a.length)
  const embedded = long.length ? new RegExp(long.map(escapeRegExp).join('|'), 'g') : null
  const translate = (text: string) => {
    const trimmed = normalize(text)
    if (!trimmed) return text
    const exact = map.get(trimmed)
    if (exact !== undefined) {
      const lead = /^\s*/.exec(text)![0]
      const trail = /\s*$/.exec(text)![0]
      return lead + exact + trail
    }
    return embedded ? text.replace(embedded, match => map.get(match) ?? match) : text
  }
  return { lang, translate }
}

/** A string that changes only when the effective phrase table for the active language changes. */
export function translatorSignature(settings: any): string {
  const lang = uiLanguage(settings)
  if (lang === 'en') return 'en'
  const catalog = settings?.localization?.translations?.[lang] || {}
  const direct = UI_I18N_PHRASES[lang] || {}
  let signature = lang
  for (const source of UI_I18N_SOURCES) {
    const value = catalog[uiPhraseKey(source)]
    if (value && value !== direct[source]) signature += `|${source}=${value}`
  }
  return signature
}

const translatorCache = new Map<string, Translator>()
/** Translators are cached by their content signature, so unrelated settings changes do not rebuild them. */
export function getTranslator(settings: any): Translator {
  const signature = translatorSignature(settings)
  let translator = translatorCache.get(signature)
  if (!translator) {
    translator = buildTranslator(settings)
    if (translatorCache.size > 8) translatorCache.clear()
    translatorCache.set(signature, translator)
  }
  return translator
}

export function translateUiText(settings: any, value: unknown = ''): string {
  return getTranslator(settings).translate(String(value ?? ''))
}

/** Translate an English source phrase containing {placeholders}, then fill them in: tr(settings, 'Showing {n} tasks', { n }). */
export function tr(settings: any, source: string, values: Record<string, unknown> = {}): string {
  return interpolateMessage(translateUiText(settings, source), values as Record<string, any>)
}

/** Look a key up in the active then fallback catalog; `fallback` is English source text, translated if possible. */
export function t(settings: any, key: string, fallback?: string): string {
  const lang = uiLanguage(settings)
  const catalog = settings?.localization?.translations || {}
  return (
    catalog?.[lang]?.[key] ||
    catalog?.[settings?.localization?.fallbackLanguage || 'en']?.[key] ||
    (fallback ? translateUiText(settings, fallback) : key)
  )
}

// ---- runtime reporting of unresolved keys (diagnostic only) -------------------------------------------------------
let reportingEnabled = false
export const setMissingKeyReporting = (enabled: boolean) => {
  reportingEnabled = enabled
}
const reported = new Set<string>()
function queueMissingKey(key: string, fallback = '', language = 'en') {
  const signature = `${language}:${key}`
  if (!reportingEnabled || !key || reported.has(signature) || reported.size > 500) return
  reported.add(signature)
  setTimeout(
    () => void api.post('/api/i18n/missing', { language, key, fallback, source: 'frontend-runtime' }).catch(() => {}),
    80
  )
}

// ---- the public engine object exposed as window.AtlasI18n for extensions -----------------------------------------
export function createAtlasI18n(settings: any = {}, runtimeResources: any = {}) {
  const language = uiLanguage(settings)
  const fallbackLanguage = settings?.localization?.fallbackLanguage || 'en'
  const direction = textDirection(settings)
  const configuredCatalog = settings?.localization?.translations || {}
  const builtinCatalog = buildTranslationCatalog()
  const resourceCatalog = runtimeResources.translations || {}
  const catalogFor = (lang: string) => ({
    ...(builtinCatalog?.[lang] || {}),
    ...(resourceCatalog?.[lang] || {}),
    ...(configuredCatalog?.[lang] || {})
  })
  const activeCatalog = catalogFor(language)
  const fallbackCatalog = catalogFor(fallbackLanguage)
  const lookup = (key: string, fallback = '', values: any = {}, options: any = {}) => {
    const scopedKey = options.namespace && !String(key).includes('.') ? `${options.namespace}.${key}` : key
    let value = (activeCatalog as any)?.[scopedKey] ?? (fallbackCatalog as any)?.[scopedKey]
    if (value == null && fallback) value = translateUiText(settings, fallback)
    if (value == null) {
      value = scopedKey
      queueMissingKey(scopedKey, fallback, language)
    }
    return interpolateMessage(value, { count: options.count, ...values })
  }
  const phrase = (source: string, values: any = {}) => lookup(uiPhraseKey(source), source, values)
  const plural = (key: string, count: number, forms: any = {}, values: any = {}) => {
    const rule = new Intl.PluralRules(language).select(Number(count))
    return lookup(`${key}.${rule}`, forms[rule] || forms.other || forms.one || key, { count, ...values }, { count })
  }
  const formatDate = (value: any, options: Intl.DateTimeFormatOptions = {}) => {
    try {
      return new Intl.DateTimeFormat(language, {
        timeZone: settings?.workspace?.defaultTimezone || undefined,
        ...options
      }).format(value instanceof Date ? value : new Date(value))
    } catch {
      return String(value ?? '')
    }
  }
  const formatNumber = (value: any, options: Intl.NumberFormatOptions = {}) => {
    try {
      return new Intl.NumberFormat(language, options).format(Number(value))
    } catch {
      return String(value ?? '')
    }
  }
  const formatCurrency = (value: any, currency = settings?.workspace?.regionalFormats?.currency || 'USD') =>
    formatNumber(value, { style: 'currency', currency })
  const registerInterface = async (namespace: string, translations: any = {}, metadata: any = {}) =>
    api.post('/api/i18n/register', { namespace, translations, metadata })
  return {
    language,
    fallbackLanguage,
    direction,
    catalog: activeCatalog,
    fallbackCatalog,
    t: lookup,
    phrase,
    plural,
    formatDate,
    formatNumber,
    formatCurrency,
    keyForPhrase: uiPhraseKey,
    registerInterface
  }
}

export function publishAtlasI18n(settings: any) {
  if (typeof window === 'undefined') return null
  const engine = createAtlasI18n(settings)
  ;(window as any).AtlasI18n = engine
  window.dispatchEvent(
    new CustomEvent('atlas:i18n-ready', {
      detail: { language: engine.language, direction: engine.direction, i18n: engine }
    })
  )
  return engine
}

// ---- user-data protection ------------------------------------------------------------------------------------------
/** Every user-entered string in the loaded workspace data, normalised. The DOM localiser never rewrites these. */
export function collectProtectedStrings(data: any): Set<string> {
  const out = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return
    const text = normalize(String(value))
    if (text) out.add(text)
  }
  const addFields = (value: any) => {
    if (!value || typeof value !== 'object') return
    for (const v of Object.values(value)) add(v)
  }
  for (const team of data?.teams || []) add(team.name)
  for (const person of data?.people || [])
    [person.name, person.email, person.jobTitle, person.role, person.focus, person.team].forEach(add)
  for (const user of data?.users || []) [user.name, user.email, user.personName, user.team].forEach(add)
  for (const project of data?.projects || []) {
    ;[project.name, project.code, project.description, project.owner, project.team].forEach(add)
    ;(project.members || []).forEach(add)
    for (const milestone of project.milestoneRows || []) add(milestone.name)
    addFields(project.customFields)
  }
  for (const task of data?.tasks || []) {
    ;[task.title, task.id, task.project, task.assignee].forEach(add)
    addFields(task.customFields)
  }
  for (const entry of data?.activity || []) {
    ;[entry.today, entry.yesterday, entry.blocked, entry.upcoming, entry.person].forEach(add)
    addFields(entry.customFields)
  }
  for (const alert of data?.alerts || []) [alert.title, alert.body, alert.project].forEach(add)
  if (data?.user) [data.user.name, data.user.email].forEach(add)
  return out
}

// ---- the DOM localiser ---------------------------------------------------------------------------------------------
const SKIP = '[data-no-i18n],[translate="no"],script,style,noscript,code,pre,textarea'
// A UI label that merely equals some user value (a project named "Reports") is still chrome when it sits in these places.
const CHROME =
  '.sidebar,.topbar,nav,th,.table-head,label,legend,h1,h2,.eyebrow,.tiny-label,.view-toggle,.settings-nav,.page-title,.stat-label,.primary-button,.secondary-button,.text-button,.toast,.modal-head'
const ATTRS = ['placeholder', 'aria-label', 'title']

interface Remembered {
  source: string
  rendered: string
}

export class DomLocalizer {
  private texts = new WeakMap<Text, Remembered>()
  private attrs = new WeakMap<Element, Record<string, Remembered>>()
  private pending = new Set<Node>()
  private frame = 0
  private observer: MutationObserver | null = null

  constructor(
    private translator: Translator,
    private protectedValues: { current: Set<string> },
    private root: HTMLElement
  ) {}

  start() {
    this.walk(this.root)
    if (typeof MutationObserver === 'undefined') return
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(node => this.pending.add(node))
        else this.pending.add(record.target)
      }
      this.schedule()
    })
    this.observer.observe(this.root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    })
  }

  stop() {
    this.observer?.disconnect()
    this.observer = null
    if (this.frame) cancelAnimationFrame(this.frame)
    this.pending.clear()
  }

  private schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      const nodes = [...this.pending]
      this.pending.clear()
      for (const node of nodes) if (node.isConnected) this.visit(node)
    })
  }

  private visit(node: Node) {
    const owner = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
    if (!owner || owner.closest(SKIP)) return
    this.walk(node)
  }

  private walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) return this.text(node as Text)
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (element.matches(SKIP)) return
    this.attributes(element)
    element.childNodes.forEach(child => this.walk(child))
  }

  private isProtected(source: string, owner: Element, chromeApplies: boolean): boolean {
    const set = this.protectedValues.current
    if (!set.size || !set.has(normalize(source))) return false
    return !(chromeApplies && owner.closest(CHROME))
  }

  private text(node: Text) {
    const owner = node.parentElement
    if (!owner || owner.closest(SKIP)) return
    const current = node.nodeValue ?? ''
    const known = this.texts.get(node)
    // If the text is what we last wrote, the source is unchanged; otherwise React (re)wrote it and it is the new source.
    const source = known && known.rendered === current ? known.source : current
    if (owner.tagName === 'OPTION' && !owner.hasAttribute('value')) owner.setAttribute('value', source.trim())
    const next = this.isProtected(source, owner, owner.tagName !== 'OPTION')
      ? source
      : this.translator.translate(source)
    if (next !== current) node.nodeValue = next
    this.texts.set(node, { source, rendered: next })
  }

  private attributes(element: Element) {
    let remembered: Record<string, Remembered> | undefined
    for (const attr of ATTRS) {
      const current = element.getAttribute(attr)
      if (!current) continue
      remembered ||= this.attrs.get(element) || {}
      const known = remembered[attr]
      const source = known && known.rendered === current ? known.source : current
      const next = this.isProtected(source, element, false) ? source : this.translator.translate(source)
      if (next !== current) element.setAttribute(attr, next)
      remembered[attr] = { source, rendered: next }
    }
    if (remembered) this.attrs.set(element, remembered)
  }
}

export function useUiLocalization(settings: any, data: any) {
  const signature = translatorSignature(settings)
  const translator = useMemo(() => getTranslator(settings), [signature])
  const protectedValues = useRef<Set<string>>(new Set())
  protectedValues.current = useMemo(() => collectProtectedStrings(data), [data])
  const direction = textDirection(settings)
  const language = uiLanguage(settings)
  // Page language/direction and the public engine follow the settings.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return
    publishAtlasI18n(settings)
    document.documentElement.lang = language
    document.documentElement.dir = direction
    document.body.dir = direction
  }, [signature, language, direction])
  // The DOM localiser is rebuilt only when the translation itself changes.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return
    const localizer = new DomLocalizer(translator, protectedValues, document.body)
    localizer.start()
    return () => localizer.stop()
  }, [translator])
}
