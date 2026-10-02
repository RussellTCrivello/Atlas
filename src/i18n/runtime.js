import { useEffect, useMemo } from 'react'
import { api } from '../api/client.js'
import { textDirection } from '../lib/localization.js'
import { buildTranslationCatalog, canonicalUiPhrase, translateUiText, uiLanguage, uiPhraseKey } from './catalog.js'

function interpolateMessage(template = '', values = {}) {
  return String(template ?? '').replace(/\{\{?\s*([\w.-]+)\s*\}?\}/g, (_, key) => values?.[key] ?? '')
}
function localeForIntl(settings) {
  return uiLanguage(settings) || settings?.language || 'en'
}
const missingI18nReports = new Set()
function queueMissingI18nKey(key, fallback = '', language = 'en') {
  const signature = `${language}:${key}`
  if (!key || missingI18nReports.has(signature) || typeof fetch === 'undefined') return
  missingI18nReports.add(signature)
  setTimeout(() => fetch('/api/i18n/missing', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, key, fallback, source: 'frontend-runtime' }) }).catch(() => {}), 80)
}
export function createAtlasI18n(settings = {}, runtimeResources = {}) {
  const language = uiLanguage(settings)
  const fallbackLanguage = settings?.localization?.fallbackLanguage || 'en'
  const direction = textDirection(settings)
  const configuredCatalog = settings?.localization?.translations || {}
  const builtinCatalog = buildTranslationCatalog()
  const resourceCatalog = runtimeResources.translations || {}
  const catalogFor = lang => ({ ...(builtinCatalog?.[lang] || {}), ...(resourceCatalog?.[lang] || {}), ...(configuredCatalog?.[lang] || {}) })
  const activeCatalog = catalogFor(language)
  const fallbackCatalog = catalogFor(fallbackLanguage)
  const lookup = (key, fallback = '', values = {}, options = {}) => {
    const scopedKey = options.namespace && !String(key).includes('.') ? `${options.namespace}.${key}` : key
    let value = activeCatalog?.[scopedKey] ?? fallbackCatalog?.[scopedKey]
    if (value == null && fallback) value = translateUiText(settings, fallback)
    if (value == null) { value = scopedKey; queueMissingI18nKey(scopedKey, fallback, language) }
    return interpolateMessage(value, { count: options.count, ...values })
  }
  const phrase = (source, values = {}) => lookup(uiPhraseKey(source), source, values)
  const plural = (key, count, forms = {}, values = {}) => {
    const rule = new Intl.PluralRules(language).select(Number(count))
    return lookup(`${key}.${rule}`, forms[rule] || forms.other || forms.one || key, { count, ...values }, { count })
  }
  const formatDate = (value, options = {}) => {
    try { return new Intl.DateTimeFormat(language, { timeZone: settings?.workspace?.defaultTimezone || undefined, ...options }).format(value instanceof Date ? value : new Date(value)) } catch { return String(value ?? '') }
  }
  const formatNumber = (value, options = {}) => {
    try { return new Intl.NumberFormat(language, options).format(Number(value)) } catch { return String(value ?? '') }
  }
  const formatCurrency = (value, currency = settings?.workspace?.regionalFormats?.currency || 'USD') => formatNumber(value, { style: 'currency', currency })
  const registerInterface = async (namespace, translations = {}, metadata = {}) => api.post('/api/i18n/register', { namespace, translations, metadata })
  return { language, fallbackLanguage, direction, catalog: activeCatalog, fallbackCatalog, t: lookup, phrase, plural, formatDate, formatNumber, formatCurrency, keyForPhrase: uiPhraseKey, canonicalPhrase: canonicalUiPhrase, registerInterface }
}
export function publishAtlasI18n(settings) {
  if (typeof window === 'undefined') return null
  const engine = createAtlasI18n(settings)
  window.AtlasI18n = engine
  window.dispatchEvent(new CustomEvent('atlas:i18n-ready', { detail: { language: engine.language, direction: engine.direction, i18n: engine } }))
  return engine
}

export function applyUiLocalization(settings) {
  if (typeof document === 'undefined' || !document.body) return
  const lang = uiLanguage(settings)
  publishAtlasI18n(settings)
  document.documentElement.lang = lang
  document.documentElement.dir = textDirection(settings)
  document.body.dir = textDirection(settings)
  const translateNode = node => {
    const parent = node.parentElement
    if (!parent || parent.closest('[data-no-i18n]') || ['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','TEXTAREA'].includes(parent.tagName)) return
    if (parent.tagName === 'OPTION' && !parent.hasAttribute('value')) parent.setAttribute('value', canonicalUiPhrase(node.nodeValue))
    const next = translateUiText(settings, node.nodeValue)
    if (next !== node.nodeValue) node.nodeValue = next
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  nodes.forEach(translateNode)
  document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(element => ['placeholder','aria-label','title'].forEach(attr => {
    const value = element.getAttribute(attr)
    if (!value || element.closest('[data-no-i18n]')) return
    const next = translateUiText(settings, value)
    if (next !== value) element.setAttribute(attr, next)
  }))
}
export function useUiLocalization(settings) {
  const lang = uiLanguage(settings)
  const catalog = settings?.localization?.translations?.[lang]
  const signature = useMemo(() => `${lang}:${Object.keys(catalog || {}).length}`, [lang, catalog])
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') { applyUiLocalization(settings); return }
    let pending = false
    const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; applyUiLocalization(settings) }) }
    run()
    const observer = new MutationObserver(run)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder','aria-label','title'] })
    return () => observer.disconnect()
  }, [settings, signature])
}
