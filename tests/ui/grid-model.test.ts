// The rules of a data grid, without a screen: sorting by several columns, column layout, what a saved view may contain, and
// filtering, sorting and paging for lists that live in the browser.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as grid from '../../src/lib/grid-model'
import type { Condition } from '../../src/lib/filters'

const defs: grid.ColumnDef[] = [
  { key: 'id', label: 'ID', fixed: true },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'owner', label: 'Owner', defaultHidden: true },
  { key: 'due', label: 'Due', minWidth: 90 }
]

describe('sorting by one or several columns', () => {
  test('a plain click sorts by that column, a second click turns it around, another column replaces it', () => {
    let sorts = grid.cycleSort([], 'title')
    assert.deepEqual(sorts, [{ key: 'title', dir: 'asc' }])
    sorts = grid.cycleSort(sorts, 'title')
    assert.deepEqual(sorts, [{ key: 'title', dir: 'desc' }])
    sorts = grid.cycleSort(sorts, 'status')
    assert.deepEqual(sorts, [{ key: 'status', dir: 'asc' }])
  })

  test('Shift adds a further sort, turns an existing one around, and stops at four', () => {
    let sorts = grid.cycleSort([], 'title')
    sorts = grid.cycleSort(sorts, 'status', true)
    assert.deepEqual(
      sorts.map(s => `${s.key}:${s.dir}`),
      ['title:asc', 'status:asc']
    )
    sorts = grid.cycleSort(sorts, 'status', true)
    assert.deepEqual(
      sorts.map(s => `${s.key}:${s.dir}`),
      ['title:asc', 'status:desc']
    )
    sorts = grid.cycleSort(sorts, 'a', true)
    sorts = grid.cycleSort(sorts, 'b', true)
    assert.equal(sorts.length, 4)
    assert.equal(grid.cycleSort(sorts, 'c', true).length, 4, 'a fifth is refused')
  })

  test('a plain click while several columns are sorted collapses to the clicked one, ascending', () => {
    const many: grid.SortSpec[] = [
      { key: 'title', dir: 'desc' },
      { key: 'status', dir: 'asc' }
    ]
    assert.deepEqual(grid.cycleSort(many, 'title'), [{ key: 'title', dir: 'asc' }])
  })

  test('position and the query-string form of a sort', () => {
    const sorts: grid.SortSpec[] = [
      { key: 'priority', dir: 'desc' },
      { key: 'due', dir: 'asc' }
    ]
    assert.deepEqual(grid.sortPosition(sorts, 'due'), { position: 2, dir: 'asc' })
    assert.equal(grid.sortPosition(sorts, 'title'), null)
    assert.equal(grid.sortParam(sorts), 'priority:desc,due:asc')
    assert.deepEqual(grid.removeSort(sorts, 'priority'), [{ key: 'due', dir: 'asc' }])
  })
})

describe('column layout', () => {
  test('the default hides what asked to be hidden and never the fixed column', () => {
    const state = grid.defaultColumns(defs)
    assert.deepEqual(state.hidden, ['owner'])
    assert.deepEqual(
      grid.visibleColumns(defs, state).map(c => c.key),
      ['id', 'title', 'status', 'due']
    )
  })

  test('a stored layout is made to fit: unknown columns go, new ones appear, fixed ones cannot be hidden, widths are clamped', () => {
    const state = grid.reconcileColumns(
      {
        order: ['due', 'ghost', 'title'],
        hidden: ['id', 'ghost', 'status'],
        widths: { title: 5, ghost: 300, due: 99999, status: Number.NaN }
      },
      defs
    )
    assert.deepEqual(state.order, ['due', 'title', 'id', 'status', 'owner'])
    assert.deepEqual(state.hidden, ['status'], 'the fixed column is shown whatever was stored')
    assert.deepEqual(state.widths, { title: grid.MIN_COLUMN_WIDTH, due: grid.MAX_COLUMN_WIDTH })
    for (const junk of [null, undefined, 'x', 42, []])
      assert.deepEqual(grid.reconcileColumns(junk as any, defs), grid.defaultColumns(defs), `junk: ${String(junk)}`)
  })

  test('columns move among themselves; the fixed one stays where it is', () => {
    const state = grid.defaultColumns(defs)
    const moved = grid.moveColumn(state, 'status', -1, defs)
    assert.deepEqual(moved.order, ['id', 'status', 'title', 'owner', 'due'])
    assert.deepEqual(
      grid.moveColumn(state, 'title', -1, defs).order,
      state.order,
      'already first among the movable ones'
    )
    assert.equal(grid.moveColumn(state, 'id', 1, defs), state, 'the fixed column does not move')
  })

  test('hiding columns never leaves the table without a column', () => {
    let state = grid.defaultColumns(defs)
    state = grid.toggleColumn(state, 'title', defs)
    state = grid.toggleColumn(state, 'status', defs)
    assert.deepEqual(state.hidden.sort(), ['owner', 'status', 'title'])
    const last = grid.toggleColumn(state, 'due', defs)
    assert.equal(last, state, 'the last column that can be hidden stays')
    assert.equal(grid.toggleColumn(state, 'id', defs), state, 'and the fixed one cannot be hidden')
    assert.deepEqual(grid.toggleColumn(state, 'owner', defs).hidden.sort(), ['status', 'title'])
  })

  test('widths respect the column minimum and the global maximum', () => {
    const state = grid.defaultColumns(defs)
    assert.equal(grid.resizeColumn(state, 'due', 10, defs).widths.due, 90)
    assert.equal(grid.resizeColumn(state, 'title', 100000, defs).widths.title, grid.MAX_COLUMN_WIDTH)
    assert.equal(grid.resizeColumn(state, 'nope', 200, defs), state)
  })
})

describe('what a saved view may contain', () => {
  const fallback: grid.GridConfig = {
    columns: grid.defaultColumns(defs),
    sort: [{ key: 'due', dir: 'asc' }],
    columnFilters: {},
    conditions: [],
    q: '',
    pageSize: 50
  }

  test('a good view comes back as it was written', () => {
    const view: grid.GridConfig = {
      columns: { order: ['id', 'due', 'title', 'status', 'owner'], hidden: ['status'], widths: { title: 300 } },
      sort: [
        { key: 'title', dir: 'desc' },
        { key: 'due', dir: 'asc' }
      ],
      columnFilters: { status: ['Done'], title: 'spec' },
      conditions: [{ join: 'OR', field: 'title', operator: 'contains', value: 'x' }],
      q: 'hello',
      pageSize: 100
    }
    assert.deepEqual(grid.parseConfig(JSON.parse(JSON.stringify(view)), defs, fallback), view)
  })

  test('a damaged or outdated view never breaks the grid: bad parts fall back, unknown columns are dropped', () => {
    const parsed = grid.parseConfig(
      {
        sort: [
          { key: 'ghost', dir: 'asc' },
          { key: 'title', dir: 'sideways' }
        ],
        columnFilters: { ghost: 'x', title: '', status: ['A'] },
        conditions: [{ field: 'title' }, { field: 'status', operator: 'equals', value: 7 }, 'junk'],
        q: 12,
        pageSize: 7
      },
      defs,
      fallback
    )
    assert.deepEqual(parsed.sort, fallback.sort)
    assert.deepEqual(parsed.columnFilters, { status: ['A'] })
    assert.deepEqual(parsed.conditions, [{ join: 'AND', field: 'status', operator: 'equals', value: '7' }])
    assert.equal(parsed.q, '')
    assert.equal(parsed.pageSize, 50)
    for (const junk of [null, 'x', 5, undefined]) assert.deepEqual(grid.parseConfig(junk, defs, fallback), fallback)
  })
})

interface Row {
  id: number
  title: string
  status: string
  owner: string
  due: string
  blocked: boolean
  effort: number | null
}
const rows: Row[] = [
  { id: 1, title: 'Write spec', status: 'To do', owner: 'Ana', due: '2030-03-01', blocked: false, effort: 5 },
  { id: 2, title: 'Review spec', status: 'Done', owner: 'Bo', due: '2030-01-15', blocked: false, effort: 2 },
  { id: 3, title: 'Ship it', status: 'To do', owner: 'Ana', due: '', blocked: true, effort: null },
  { id: 4, title: 'write tests', status: 'In progress', owner: 'Bo', due: '2030-02-10', blocked: false, effort: 8 },
  { id: 5, title: 'Plan', status: 'Done', owner: '', due: '2030-02-10', blocked: false, effort: 3 }
]
const columns: grid.LocalColumn<Row>[] = [
  { key: 'title', label: 'Title', value: r => r.title, filter: 'text' },
  { key: 'status', label: 'Status', value: r => r.status, filter: 'select' },
  { key: 'owner', label: 'Owner', value: r => r.owner, filter: 'select' },
  { key: 'due', label: 'Due', value: r => r.due, filter: 'dateRange' },
  { key: 'blocked', label: 'Blocked', value: r => r.blocked, filter: 'boolean' },
  { key: 'effort', label: 'Effort', value: r => r.effort, filter: 'number' }
]
const query = (over: Partial<grid.LocalQuery<Row>> = {}): grid.LocalQuery<Row> => ({
  q: '',
  columnFilters: {},
  conditions: [],
  ...over
})
const titles = (list: Row[]) => list.map(r => r.title)

describe('filtering a list that lives in the browser', () => {
  test('global search looks in every column, ignoring case', () => {
    assert.deepEqual(titles(grid.filterLocal(rows, columns, query({ q: 'SPEC' }))), ['Write spec', 'Review spec'])
    assert.deepEqual(
      titles(grid.filterLocal(rows, columns, query({ q: 'bo' }))),
      ['Review spec', 'write tests'],
      'the owner column counts too'
    )
    assert.equal(grid.filterLocal(rows, columns, query({ q: 'zzz' })).length, 0)
  })

  test('each column filter narrows further, and all of them together intersect', () => {
    const f = (columnFilters: grid.ColumnFilters) => titles(grid.filterLocal(rows, columns, query({ columnFilters })))
    assert.deepEqual(f({ title: 'write' }), ['Write spec', 'write tests'])
    assert.deepEqual(f({ status: ['To do', 'Done'] }), ['Write spec', 'Review spec', 'Ship it', 'Plan'])
    assert.deepEqual(f({ status: ['To do'], owner: ['Ana'] }), ['Write spec', 'Ship it'])
    assert.deepEqual(f({ status: ['To do'], owner: ['Ana'], title: 'ship' }), ['Ship it'])
    assert.deepEqual(f({ due: { from: '2030-02-01', to: '2030-02-28' } }), ['write tests', 'Plan'])
    assert.deepEqual(
      f({ due: { from: '2030-03-01' } }),
      ['Write spec'],
      'a row without a date is never in a date range'
    )
    assert.deepEqual(f({ blocked: 'true' }), ['Ship it'])
    assert.deepEqual(
      f({ effort: { from: '3', to: '5' } }),
      ['Write spec', 'Plan'],
      'an empty number is never in a range'
    )
    assert.deepEqual(f({ title: '', status: [] }), titles(rows), 'an empty filter is no filter')
  })

  test('search, column filters and the advanced filter all apply at once (AND between the three)', () => {
    const conditions: Condition[] = [
      { join: 'AND', field: 'owner', operator: 'equals', value: 'Ana' },
      { join: 'OR', field: 'owner', operator: 'equals', value: 'Bo' }
    ]
    const both = grid.filterLocal(rows, columns, query({ conditions }))
    assert.deepEqual(titles(both), ['Write spec', 'Review spec', 'Ship it', 'write tests'])
    const narrowed = grid.filterLocal(
      rows,
      columns,
      query({ conditions, columnFilters: { status: ['Done'] }, q: 'spec' })
    )
    assert.deepEqual(titles(narrowed), ['Review spec'], 'the column filter and the search narrow even the OR')
  })
})

describe('sorting a list that lives in the browser', () => {
  test('the first column decides, the next breaks ties, and equal rows keep their order', () => {
    const sorted = grid.sortLocal(rows, columns, [
      { key: 'status', dir: 'asc' },
      { key: 'title', dir: 'desc' }
    ])
    assert.deepEqual(titles(sorted), ['Review spec', 'Plan', 'write tests', 'Write spec', 'Ship it'])
    assert.deepEqual(
      sorted.map(r => r.status),
      ['Done', 'Done', 'In progress', 'To do', 'To do']
    )
    assert.deepEqual(titles(sorted).slice(0, 2), ['Review spec', 'Plan'], 'within Done: title descending')
    assert.deepEqual(titles(sorted).slice(3), ['Write spec', 'Ship it'], 'within To do: title descending')
  })

  test('empty values come last whichever way the column is sorted; numbers sort as numbers, text ignores case', () => {
    const asc = grid.sortLocal(rows, columns, [{ key: 'due', dir: 'asc' }]).map(r => r.due)
    const desc = grid.sortLocal(rows, columns, [{ key: 'due', dir: 'desc' }]).map(r => r.due)
    assert.equal(asc.at(-1), '')
    assert.equal(desc.at(-1), '')
    assert.deepEqual(
      grid.sortLocal(rows, columns, [{ key: 'effort', dir: 'asc' }]).map(r => r.effort),
      [2, 3, 5, 8, null]
    )
    assert.deepEqual(titles(grid.sortLocal(rows, columns, [{ key: 'title', dir: 'asc' }])), [
      'Plan',
      'Review spec',
      'Ship it',
      'Write spec',
      'write tests'
    ])
  })

  test('an unknown sort column leaves the order alone, and the input is never mutated', () => {
    const before = titles(rows)
    assert.deepEqual(titles(grid.sortLocal(rows, columns, [{ key: 'ghost', dir: 'asc' }])), before)
    grid.sortLocal(rows, columns, [{ key: 'title', dir: 'desc' }])
    assert.deepEqual(titles(rows), before)
  })
})

describe('paging a list that lives in the browser', () => {
  const many = Array.from({ length: 95 }, (_, i) => i)
  test('pages, totals and the clamping of a page that no longer exists (after a filter shrank the list)', () => {
    const first = grid.paginate(many, 1, 25)
    assert.deepEqual([first.rows.length, first.pages, first.total, first.page], [25, 4, 95, 1])
    assert.equal(grid.paginate(many, 4, 25).rows.length, 20)
    assert.equal(grid.paginate(many, 99, 25).page, 4, 'past the end: the last page')
    assert.equal(grid.paginate(many, -3, 25).page, 1)
    const none = grid.paginate([], 3, 25)
    assert.deepEqual([none.rows.length, none.pages, none.page], [0, 1, 1], 'an empty list still has one (empty) page')
  })
})
