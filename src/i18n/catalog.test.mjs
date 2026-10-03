import assert from 'node:assert/strict'
import { buildTranslationCatalog, translateUiText, uiPhraseKey, UI_I18N_SOURCES } from './catalog.js'
import { EXTENDED_UI_PHRASES } from './interface-phrases.js'
import { ADDITIONAL_UI_PHRASES } from './interface-phrases-additional.js'
import { PRODUCT_UI_PHRASES } from './interface-phrases-product.js'

const catalog = buildTranslationCatalog()
assert.deepEqual(Object.keys(catalog), ['en', 'ar', 'fa', 'he'])
assert.equal(catalog.en['nav.overview'], 'Overview')
assert.equal(catalog.ar['nav.overview'], 'نظرة عامة')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'Overview'), 'نظرة عامة')
assert.equal(translateUiText({ localization: { defaultLanguage: 'en', translations: catalog } }, 'Overview'), 'Overview')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, '  Overview  '), '  نظرة عامة  ')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'An unknown custom phrase'), 'An unknown custom phrase')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'Customer text mentioning Save changes must stay untouched.'), 'Customer text mentioning Save changes must stay untouched.')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'The project is On track and the owner is a Manager.'), 'The project is On track and the owner is a Manager.')
assert.equal(uiPhraseKey('Project Health'), 'ui.project_health')
const interfacePhrases = [...EXTENDED_UI_PHRASES, ...ADDITIONAL_UI_PHRASES, ...PRODUCT_UI_PHRASES]
assert.ok(interfacePhrases.length >= 500, 'extended catalogs include broad interface coverage')
assert.equal(new Set(interfacePhrases.map(([source]) => source)).size, interfacePhrases.length, 'interface phrase sources are unique')
assert.notEqual(uiPhraseKey('Completions / intake'), uiPhraseKey('Completions / intake %'), 'different punctuation must not collide in translation keys')
for (const [source, ar, fa, he] of interfacePhrases) {
  assert.ok(source && ar && fa && he, `all enabled languages define ${source}`)
  assert.equal(catalog.ar[uiPhraseKey(source)], ar, `Arabic catalog contains ${source}`)
  assert.equal(catalog.fa[uiPhraseKey(source)], fa, `Persian catalog contains ${source}`)
  assert.equal(catalog.he[uiPhraseKey(source)], he, `Hebrew catalog contains ${source}`)
}
// Intentionally preserved identifiers: file-format acronyms/product names, literal keycaps,
// configuration-key examples, a sample URL, and the Atlas product name.
const intentionallyPreservedSources = new Set([
  'PDF', 'Excel', 'CSV', 'JSON', 'Esc', '⌘K',
  'translation.key', 'settings.projects.create_button', 'field_key', 'module_key', 'nav.module_key',
  'https://internal.example/webhook', 'Atlas'
])
for (const language of ['ar', 'fa', 'he']) {
  const untranslated = UI_I18N_SOURCES.filter(source => catalog[language][uiPhraseKey(source)] === source)
  assert.deepEqual(untranslated.sort(), [...intentionallyPreservedSources].filter(source => untranslated.includes(source)).sort(), `${language} has no untranslated interface copy beyond explicitly preserved technical identifiers`)
  assert.notEqual(catalog[language][uiPhraseKey('My profile')], 'My profile', `${language} includes the profile page label`)
  assert.notEqual(catalog[language][uiPhraseKey('Save profile')], 'Save profile', `${language} includes the profile action`)
  assert.notEqual(catalog[language][uiPhraseKey('Change interface language')], 'Change interface language', `${language} includes the quick language switch label`)
}
assert.equal(translateUiText({ localization: { defaultLanguage: 'fa', translations: catalog } }, 'Save profile'), 'ذخیره پروفایل')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'Task board'), 'لوحة متابعة المهام')
assert.equal(translateUiText({ localization: { defaultLanguage: 'fa', translations: catalog } }, 'Task board'), 'تابلوی پیگیری وظایف')
assert.equal(translateUiText({ localization: { defaultLanguage: 'he', translations: catalog } }, 'Task board'), 'לוח מעקב משימות')

console.log('Localization catalog and translation checks passed')
