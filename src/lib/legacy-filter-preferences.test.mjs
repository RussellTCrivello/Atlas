import assert from 'node:assert/strict'
import { clearLegacyFilterPreferences, mergeLegacyFilterPreferences, readLegacyFilterPreferences } from './legacy-filter-preferences.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  }
}

const storage = memoryStorage({
  'atlas-filter-projects': JSON.stringify([{ field: 'name', operator: 'contains', join: 'AND', value: 'Atlas' }]),
  'atlas-filter-tasks': JSON.stringify([{ field: 'status', operator: 'not-an-operator', value: 'Done' }]),
  'atlas-filter-people': '{invalid json'
})
const legacy = readLegacyFilterPreferences(storage)
assert.deepEqual(legacy, { projects: [{ field: 'name', operator: 'contains', join: 'AND', value: 'Atlas' }] })
assert.deepEqual(mergeLegacyFilterPreferences({ projects: [] }, legacy), { projects: [] })
assert.deepEqual(mergeLegacyFilterPreferences({}, legacy), legacy)
clearLegacyFilterPreferences(storage)
assert.equal(storage.values.size, 0)
console.log('Legacy saved-filter import checks passed')
