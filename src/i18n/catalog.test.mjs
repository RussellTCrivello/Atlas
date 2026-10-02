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

console.log('Localization catalog and translation checks passed')
