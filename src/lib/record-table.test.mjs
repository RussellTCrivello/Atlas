import assert from 'node:assert/strict'
import { clampPage, filterRecordRows, parseCsv, selectRange, sortRecordRows, toggleSelection } from './record-table.js'

const rows = [
  { id: 'a', title: 'Beta', status: 'Open', owner: { name: 'Sam' }, rank: 10 },
  { id: 'b', title: 'Alpha', status: 'Open', owner: { name: 'Lee' }, rank: 20 },
  { id: 'c', title: 'Alpha', status: 'Done', owner: { name: 'Sam' }, rank: 15 }
]
const columns = [{ key: 'title' }, { key: 'status' }, { key: 'owner.name' }, { key: 'rank', type: 'number' }]
assert.deepEqual(sortRecordRows(rows, [{ key: 'title', dir: 'asc' }, { key: 'rank', dir: 'desc' }], columns).map(row => row.id), ['b', 'c', 'a'])
assert.deepEqual(filterRecordRows(rows, { query: 'sam', columns }).map(row => row.id), ['a', 'c'])
assert.deepEqual(filterRecordRows(rows, { columnFilters: { status: 'open' }, columns }).map(row => row.id), ['a', 'b'])
assert.deepEqual(filterRecordRows(rows, { advanced: [
  { field: 'title', operator: 'equals', value: 'Alpha', join: 'AND' },
  { field: 'rank', operator: 'gt', value: '16', join: 'OR' }
] }).map(row => row.id), ['b', 'c'])

assert.deepEqual([...selectRange(new Set(['a']), ['a', 'b', 'c'], 'a', 'c')], ['a', 'b', 'c'])
assert.deepEqual([...selectRange(new Set(['a', 'b', 'c']), ['a', 'b', 'c'], 'a', 'c', { toggle: true })], [])
assert.deepEqual([...toggleSelection(new Set(['a']), 'a')], [])
assert.equal(clampPage(9, 3), 2)
const benchmarkRows = Array.from({ length: 50000 }, (_, index) => ({ id: String(index), title: `Task ${index}`, rank: index }))
assert.equal(filterRecordRows(benchmarkRows, { query: 'Task 49999', columns: [{ key: 'title' }] }).length, 1)
assert.equal(sortRecordRows(benchmarkRows, [{ key: 'rank', dir: 'desc' }], [{ key: 'rank', type: 'number' }]).length, 50000)
assert.equal(selectRange(new Set(), benchmarkRows.map(row => row.id), '0', '49999').size, 50000)
assert.deepEqual(parseCsv('title,status\n"Task, one","Open"\n"Second ""quoted"" task",Done'), [
  { title: 'Task, one', status: 'Open' }, { title: 'Second "quoted" task', status: 'Done' }
])
console.log('record-table selection, filter, sort, page, and CSV utility checks passed')
