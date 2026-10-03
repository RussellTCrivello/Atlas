import assert from 'node:assert/strict'
import { buildTranslationCatalog, translateUiText } from './catalog.js'
import { exportText, localizeExportColumns, localizeExportValue } from './export-catalog.js'

const catalog = buildTranslationCatalog()
for (const language of ['ar', 'fa', 'he']) {
  const settings = { localization: { defaultLanguage: language, translations: catalog } }
  const taskColumns = localizeExportColumns('tasks', [
    { key: 'title', label: 'Task' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'customFields.status', label: 'Customer status' }
  ], settings)
  assert.equal(taskColumns[0].label, translateUiText(settings, 'Task'))
  assert.equal(taskColumns[1].label, translateUiText(settings, 'Status'))
  assert.equal(taskColumns[1].translateValue, true)
  assert.equal(taskColumns[0].translateValue, false)
  assert.equal(taskColumns[3].translateValue, false)
  assert.equal(localizeExportValue('In progress', taskColumns[1], settings), translateUiText(settings, 'In progress'))
  assert.equal(localizeExportValue('Do not translate this task title', taskColumns[0], settings), 'Do not translate this task title')
  assert.equal(localizeExportValue(true, { key: 'resolved', type: 'boolean' }, settings), translateUiText(settings, 'Yes'))
  assert.equal(localizeExportValue(false, { key: 'resolved', type: 'boolean' }, settings), translateUiText(settings, 'No'))
  assert.equal(exportText(settings, 'Prepared by'), translateUiText(settings, 'Prepared by'))
}

const accountColumns = localizeExportColumns('users', [{ key: 'role', label: 'Role' }], { localization: { defaultLanguage: 'ar', translations: catalog } })
assert.equal(localizeExportValue('Administrator', accountColumns[0], { localization: { defaultLanguage: 'ar', translations: catalog } }), 'مسؤول')
const personColumns = localizeExportColumns('people', [{ key: 'role', label: 'Job title' }], { localization: { defaultLanguage: 'ar', translations: catalog } })
assert.equal(personColumns[0].translateValue, false, 'user-authored job titles are not translated as account roles')

console.log('Export localization preserves free text and localizes labels and fixed values')
