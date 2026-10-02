import assert from 'node:assert/strict'
import { applyAdvancedFilters, configuredColumns, sortRows } from './advanced-filters.js'

const rows = [
  { name: 'Atlas Alpha', score: 2, owner: { name: 'Amina' } },
  { name: 'Atlas Beta', score: 12, owner: { name: 'Mona' } },
  { name: 'Orion', score: 7, owner: { name: 'Amina' } }
]

assert.equal(applyAdvancedFilters(rows, []), rows)
assert.deepEqual(applyAdvancedFilters(rows, [
  { field: 'score', operator: 'gte', join: 'AND', value: '7' },
  { field: 'owner.name', operator: 'equals', join: 'OR', value: 'Mona' }
]).map((row) => row.name), ['Atlas Beta', 'Orion'])
assert.deepEqual(sortRows(rows, { key: 'score', dir: 'desc' }).map((row) => row.score), [12, 7, 2])
assert.deepEqual(rows.map((row) => row.score), [2, 12, 7], 'sorting must not mutate its input')
assert.deepEqual(configuredColumns({ interface: { tableColumns: { projects: ['score', 'unknown', 'name'] } } }, 'projects', [
  { key: 'name', label: 'Name' }, { key: 'score', label: 'Score' }
]), [{ key: 'score', label: 'Score' }, { key: 'name', label: 'Name' }])
console.log('Advanced filter and table utility checks passed')
