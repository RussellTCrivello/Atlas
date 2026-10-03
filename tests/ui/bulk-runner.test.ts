// The chunked bulk runner and the grid-to-API mapping, without a screen.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CHUNK_SIZE, newBatchId, runBulk, summarize } from '../../src/lib/bulk'
import { ApiError } from '../../src/lib/api'
import { taskParams } from '../../src/features/records/task-query'

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
type Call = { path: string; body: any }
const fake = (answer: (call: Call, index: number) => any) => {
  const calls: Call[] = []
  return {
    calls,
    post: async (path: string, body: unknown) => {
      const call = { path, body: body as any }
      calls.push(call)
      return answer(call, calls.length - 1)
    }
  }
}
const ok = (call: Call) => ({ requested: call.body.ids.length, succeeded: call.body.ids.length, failed: [] })

describe('running an action over a large selection', () => {
  test('ids go in chunks of 200, every id exactly once, and progress is reported after each chunk', async () => {
    const server = fake(ok)
    const progress: number[] = []
    const result = await runBulk({
      endpoint: '/api/tasks/bulk',
      ids: range(450),
      body: { action: 'status', status: 'Done' },
      post: server.post,
      onProgress: p => progress.push(p.done)
    })
    assert.deepEqual(
      server.calls.map(c => c.body.ids.length),
      [200, 200, 50]
    )
    assert.deepEqual(
      server.calls.flatMap(c => c.body.ids),
      range(450)
    )
    assert.deepEqual(progress, [200, 400, 450])
    assert.deepEqual(
      [result.requested, result.succeeded, result.failed.length, result.notAttempted, result.cancelled],
      [450, 450, 0, 0, false]
    )
    assert.ok(
      server.calls.every(c => c.body.action === 'status' && c.body.status === 'Done'),
      'the action travels with every chunk'
    )
    assert.equal(CHUNK_SIZE, 200)
  })

  test('a list with repeats is sent once per id', async () => {
    const server = fake(ok)
    const result = await runBulk({ endpoint: '/x', ids: [1, 2, 2, 3, 1], body: {}, post: server.post })
    assert.deepEqual(server.calls[0].body.ids, [1, 2, 3])
    assert.equal(result.requested, 3)
  })

  test('failures are collected across chunks with their reasons, and the successes are still counted', async () => {
    const server = fake((call, index) => ({
      requested: call.body.ids.length,
      succeeded: call.body.ids.length - 1,
      failed: [{ id: call.body.ids[0], label: `Task ${index}`, reason: 'Not allowed' }]
    }))
    const result = await runBulk({ endpoint: '/x', ids: range(300), body: {}, post: server.post })
    assert.equal(result.succeeded, 298)
    assert.deepEqual(
      result.failed.map(f => f.label),
      ['Task 0', 'Task 1']
    )
    assert.equal(summarize(result, 'tasks', 'Changed'), 'Changed 298 of 300 tasks · 2 could not be changed')
  })

  test('stopping between chunks leaves the rest untouched and says how many were never attempted', async () => {
    const signal = { aborted: false }
    const server = fake(ok)
    const result = await runBulk({
      endpoint: '/x',
      ids: range(1000),
      body: {},
      post: server.post,
      signal,
      onProgress: p => {
        if (p.done >= 400) signal.aborted = true
      }
    })
    assert.equal(server.calls.length, 2, 'no request is sent after the stop')
    assert.deepEqual([result.succeeded, result.notAttempted, result.cancelled], [400, 600, true])
    assert.match(summarize(result, 'tasks', 'Changed'), /600 not attempted/)
  })

  test('a request that fails outright stops the run; what already happened is still reported', async () => {
    const server = fake((call, index) => {
      if (index === 1) throw new ApiError(0, 'Cannot reach the Atlas server.', 'NETWORK')
      return ok(call)
    })
    const result = await runBulk({ endpoint: '/x', ids: range(500), body: {}, post: server.post })
    assert.equal(result.succeeded, 200, 'the first chunk went through')
    assert.equal(result.notAttempted, 300)
    assert.equal(result.error, 'Cannot reach the Atlas server.')
    assert.equal(server.calls.length, 2, 'it did not carry on after the failure')
  })

  test('the chunks of a delete share one batch id, so one Undo restores them all', async () => {
    const batch = newBatchId()
    const server = fake(ok)
    const result = await runBulk({
      endpoint: '/x',
      ids: range(450),
      body: { action: 'delete' },
      post: server.post,
      batch
    })
    assert.ok(server.calls.every(c => c.body.batch === batch))
    assert.equal(result.batch, batch)
    assert.notEqual(newBatchId(), newBatchId())
    const without = fake(ok)
    await runBulk({ endpoint: '/x', ids: [1], body: {}, post: without.post })
    assert.ok(!('batch' in without.calls[0].body), 'no batch unless asked for')
  })

  test('an empty selection sends nothing', async () => {
    const server = fake(ok)
    const result = await runBulk({ endpoint: '/x', ids: [], body: {}, post: server.post })
    assert.equal(server.calls.length, 0)
    assert.equal(result.requested, 0)
  })
})

describe('the task grid as a request to the server', () => {
  const base = {
    q: '',
    sort: [{ key: 'due', dir: 'asc' as const }],
    columnFilters: {},
    conditions: [],
    page: 1,
    pageSize: 50
  }
  const get = (over: object, options?: { paged?: boolean }) =>
    Object.fromEntries(taskParams({ ...base, ...over }, options))

  test('search, sort, page and the fixed scope of the grid', () => {
    const params = get({
      q: ' spec ',
      sort: [
        { key: 'priority', dir: 'desc' },
        { key: 'due', dir: 'asc' }
      ],
      page: 3,
      pageSize: 100,
      fixed: { project: '12', assignee: '' }
    })
    assert.deepEqual(params, { project: '12', q: 'spec', sort: 'priority:desc,due:asc', page: '3', pageSize: '100' })
  })

  test('column filters use the server parameters that exist, and conditions for the rest', () => {
    const params = get({
      columnFilters: {
        status: ['In progress', 'Done'],
        priority: ['High'],
        assignee: ['me'],
        blocked: 'true',
        due: { from: '2030-01-01', to: '2030-01-31' },
        title: ' spec ',
        key: 'PAY-1',
        tags: 'urgent',
        created: { from: '2030-02-01' }
      }
    })
    assert.equal(params.status, 'In progress,Done')
    assert.equal(params.priority, 'High')
    assert.equal(params.assignee, 'me')
    assert.equal(params.blocked, 'true')
    assert.equal(params.dueFrom, '2030-01-01')
    assert.equal(params.dueTo, '2030-01-31')
    const describeCondition = (c: { field: string; operator: string; value: string }) =>
      `${c.field}|${c.operator}|${c.value}`
    assert.deepEqual(JSON.parse(params.cf).map(describeCondition).sort(), [
      'createdAt|gte|2030-02-01',
      'id|contains|PAY-1',
      'tags|contains|urgent',
      'title|contains|spec'
    ])
  })

  test('empty filters and unknown columns send nothing; the advanced filter travels as it is', () => {
    const params = get({
      columnFilters: { status: [], title: '', ghost: 'x', blocked: 'maybe', due: {} },
      conditions: [{ join: 'OR', field: 'title', operator: 'contains', value: 'x' }],
      sort: [{ key: 'ghost', dir: 'asc' }]
    })
    assert.deepEqual(Object.keys(params).sort(), ['page', 'pageSize', 'where'])
    assert.deepEqual(JSON.parse(params.where), [{ join: 'OR', field: 'title', operator: 'contains', value: 'x' }])
  })

  test('the ids request carries the same filters but no page', () => {
    const params = get({ q: 'x', columnFilters: { priority: ['Low'] } }, { paged: false })
    assert.ok(!('page' in params) && !('pageSize' in params))
    assert.deepEqual([params.q, params.priority], ['x', 'Low'])
  })
})
