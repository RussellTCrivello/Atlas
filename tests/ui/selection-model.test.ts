// The selection rules, tested without a screen. What matters most is what a selection must NOT do: reach rows that were not
// ticked, forget rows on other pages when the header is used, or survive the removal of the records it points at.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as selection from '../../src/lib/selection'

const rows = [1, 2, 3, 4, 5, 6, 7, 8]
const ids = (state: selection.SelectionState) => selection.toArray(state).sort((a, b) => Number(a) - Number(b))
const start = selection.EMPTY_SELECTION

describe('ticking records', () => {
  test('a tick toggles one record and leaves the others alone', () => {
    let state = selection.toggle(start, 3)
    state = selection.toggle(state, 5)
    assert.deepEqual(ids(state), [3, 5])
    state = selection.toggle(state, 3)
    assert.deepEqual(ids(state), [5], 'the same control that selects also deselects')
  })

  test('the original selection is never mutated (the screen re-renders from the new value)', () => {
    const a = selection.toggle(start, 1)
    selection.toggle(a, 2)
    assert.deepEqual(ids(a), [1])
    assert.equal(selection.sizeOf(start), 0)
  })

  test('Shift selects everything from the last tick to this one, in either direction, and keeps earlier ticks', () => {
    const anchored = selection.toggle(selection.toggle(start, 8), 3) // 8 elsewhere, anchor = 3
    assert.deepEqual(ids(selection.pick(anchored, rows, 6, { shift: true })), [3, 4, 5, 6, 8])
    assert.deepEqual(ids(selection.pick(anchored, rows, 1, { shift: true })), [1, 2, 3, 8])
  })

  test('Shift with no anchor on this page behaves like a plain tick instead of selecting something arbitrary', () => {
    assert.deepEqual(ids(selection.pick(start, rows, 4, { shift: true })), [4])
    const elsewhere = selection.toggle(start, 99) // anchor is on another page
    assert.deepEqual(ids(selection.pick(elsewhere, rows, 4, { shift: true })), [4, 99])
  })

  test('a range never reaches rows outside the visible page', () => {
    const anchored = selection.toggle(start, 2)
    const result = selection.pick(anchored, [2, 3, 4], 4, { shift: true })
    assert.deepEqual(ids(result), [2, 3, 4])
    assert.ok(!selection.has(result, 5))
  })
})

describe('the header control and "select all"', () => {
  test('the page is none, some or all selected, and only counts the rows shown', () => {
    assert.equal(selection.pageState(start, rows), 'none')
    assert.equal(selection.pageState(selection.toggle(start, 2), rows), 'some')
    assert.equal(selection.pageState(selection.selectAll(start, rows), rows), 'all')
    assert.equal(
      selection.pageState(selection.selectAll(start, [99]), rows),
      'none',
      'a selection on another page is not this page'
    )
    assert.equal(selection.pageState(start, []), 'none', 'an empty page is never "all"')
  })

  test('the header ticks a partly ticked page, and unticks a fully ticked one, without touching other pages', () => {
    const elsewhere = selection.toggle(start, 99)
    const partly = selection.toggle(elsewhere, 2)
    const ticked = selection.togglePage(partly, rows)
    assert.deepEqual(ids(ticked), [1, 2, 3, 4, 5, 6, 7, 8, 99])
    const unticked = selection.togglePage(ticked, rows)
    assert.deepEqual(ids(unticked), [99], 'the record selected on another page stays selected')
  })

  test('"select all matching" adds every id it is given, and deselect removes exactly the ones named', () => {
    const everything = Array.from({ length: 250 }, (_, i) => i + 1)
    const all = selection.selectAll(start, everything)
    assert.equal(selection.sizeOf(all), 250)
    const fewer = selection.deselect(all, [1, 2, 3])
    assert.equal(selection.sizeOf(fewer), 247)
    assert.ok(!selection.has(fewer, 2) && selection.has(fewer, 4))
    assert.equal(selection.sizeOf(selection.clear()), 0)
  })

  test('records that no longer exist drop out of the selection (after a delete or a reload)', () => {
    const state = selection.selectAll(start, [1, 2, 3])
    const alive = selection.prune(state, id => id !== 2)
    assert.deepEqual(ids(alive), [1, 3])
    assert.equal(
      selection.prune(alive, () => true),
      alive,
      'nothing to drop: the same value, so no re-render'
    )
  })
})

describe('keyboard selection', () => {
  test('Shift+Down extends from the focused row; Shift+Up back over it shrinks again', () => {
    let state = selection.extend(start, rows, 3, 1)
    assert.deepEqual(ids(state), [3, 4])
    state = selection.extend(state, rows, 4, 1)
    assert.deepEqual(ids(state), [3, 4, 5])
    state = selection.extend(state, rows, 5, -1)
    assert.deepEqual(ids(state), [3, 4], 'moving back un-ticks the row it left')
  })

  test('there is nothing to extend into at the ends of the list', () => {
    assert.equal(selection.extend(start, rows, 8, 1), start)
    assert.equal(selection.extend(start, rows, 1, -1), start)
    assert.equal(selection.extend(start, rows, 42, 1), start, 'a row that is not shown')
  })
})
