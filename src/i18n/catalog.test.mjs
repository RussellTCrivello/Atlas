import assert from 'node:assert/strict'
import { buildTranslationCatalog, translateUiText, uiPhraseKey } from './catalog.js'

const catalog = buildTranslationCatalog()
assert.deepEqual(Object.keys(catalog), ['en', 'ar', 'fa', 'he'])
assert.equal(catalog.en['nav.overview'], 'Overview')
assert.equal(catalog.ar['nav.overview'], 'نظرة عامة')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'Overview'), 'نظرة عامة')
assert.equal(translateUiText({ localization: { defaultLanguage: 'en', translations: catalog } }, 'Overview'), 'Overview')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, '  Overview  '), '  نظرة عامة  ')
assert.equal(translateUiText({ localization: { defaultLanguage: 'ar', translations: catalog } }, 'An unknown custom phrase'), 'An unknown custom phrase')
assert.equal(uiPhraseKey('Project Health'), 'ui.project_health')
for (const language of ['ar', 'fa', 'he']) {
  assert.notEqual(catalog[language][uiPhraseKey('My profile')], 'My profile', `${language} includes the profile page label`)
  assert.notEqual(catalog[language][uiPhraseKey('Save profile')], 'Save profile', `${language} includes the profile action`)
  assert.notEqual(catalog[language][uiPhraseKey('Change interface language')], 'Change interface language', `${language} includes the quick language switch label`)
}
assert.equal(translateUiText({ localization: { defaultLanguage: 'fa', translations: catalog } }, 'Save profile'), 'ذخیره پروفایل')

console.log('Localization catalog and translation checks passed')
