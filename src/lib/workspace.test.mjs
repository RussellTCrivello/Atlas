import assert from 'node:assert/strict'
import { mergeSettingsWithDefaults, updateByPath } from './workspace.js'

const initial = { localization: { translations: { en: { 'settings.projects.create_button': 'Create project', nested: { value: 'old' } } } } }
const updated = updateByPath(initial, ['localization', 'translations', 'en', 'settings.projects.create_button'], 'New project')
assert.equal(updated.localization.translations.en['settings.projects.create_button'], 'New project')
assert.deepEqual(updated.localization.translations.en.nested, { value: 'old' })
assert.equal(initial.localization.translations.en['settings.projects.create_button'], 'Create project', 'updates do not mutate the source settings')
const nested = updateByPath(initial, 'localization.translations.en.nested.value', 'new')
assert.equal(nested.localization.translations.en.nested.value, 'new')
const unsafe = updateByPath(initial, ['localization', 'translations', '__proto__', 'polluted'], true)
assert.equal(({}).polluted, undefined, 'prototype-sensitive segments are ignored')
assert.equal(Object.hasOwn(unsafe.localization.translations, '__proto__'), false)

const mergedDefaults = mergeSettingsWithDefaults(
  { localization: { translations: { en: { builtIn: 'Default' } } }, permissions: { roles: { Administrator: {}, Viewer: {} } }, customFields: { tasks: [{ key: 'old' }] } },
  { localization: { translations: {} }, permissions: { roles: {} }, customFields: { tasks: [] } }
)
assert.deepEqual(mergedDefaults.localization.translations, {}, 'explicit empty maps remain empty instead of being refilled from client defaults')
assert.deepEqual(mergedDefaults.permissions.roles, {}, 'deleted custom/default map entries stay deleted in the UI')
assert.deepEqual(mergedDefaults.customFields.tasks, [], 'explicitly cleared custom-field lists stay cleared')

console.log('Settings path segments and map replacement preserve literal keys and deleted entries')
