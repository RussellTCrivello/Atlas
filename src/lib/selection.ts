// The selection model of every list: which records are ticked. Pure functions over an immutable state, so the rules (a plain
// tick toggles, Ctrl/Cmd toggles, Shift selects a range from the last one ticked, the header selects the page) are written once
// and tested without a screen. A selection is always an explicit set of ids: nothing is ever "selected" implicitly, which is
// why an action can state exactly how many records it will touch.
export type RecordId = number | string

export interface SelectionState {
  readonly ids: ReadonlySet<RecordId>
  /** The record the last range starts from (the last one ticked on its own). */
  readonly anchor: RecordId | null
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchor: null }

export interface Modifiers {
  shift?: boolean
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  toggle?: boolean
}

const withIds = (
  state: SelectionState,
  ids: Iterable<RecordId>,
  anchor: RecordId | null = state.anchor
): SelectionState => ({
  ids: new Set(ids),
  anchor
})

/** Flip one record. It becomes the anchor for the next Shift range. */
export function toggle(state: SelectionState, id: RecordId): SelectionState {
  const ids = new Set(state.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return withIds(state, ids, id)
}

/** Everything between the anchor and `to` (in the order the rows are shown) joins the selection. */
export function selectRange(state: SelectionState, visible: RecordId[], to: RecordId): SelectionState {
  const end = visible.indexOf(to)
  const start = state.anchor === null ? -1 : visible.indexOf(state.anchor)
  if (end < 0 || start < 0) return toggle(state, to) // no usable anchor on this page: behave like a plain tick
  const [from, until] = start <= end ? [start, end] : [end, start]
  const ids = new Set(state.ids)
  for (const id of visible.slice(from, until + 1)) ids.add(id)
  return withIds(state, ids, state.anchor)
}

/** A tick on one record, with whatever keys were held. */
export function pick(
  state: SelectionState,
  visible: RecordId[],
  id: RecordId,
  modifiers: Modifiers = {}
): SelectionState {
  return modifiers.shift ? selectRange(state, visible, id) : toggle(state, id)
}

/** Select every record in `ids` (the rows of the page, or every id matching a filter). */
export function selectAll(state: SelectionState, ids: RecordId[]): SelectionState {
  return withIds(state, [...state.ids, ...ids], state.anchor)
}

/** Remove `ids` from the selection (the header control unticking the page). */
export function deselect(state: SelectionState, ids: RecordId[]): SelectionState {
  const drop = new Set(ids)
  return withIds(
    state,
    [...state.ids].filter(id => !drop.has(id)),
    state.anchor !== null && drop.has(state.anchor) ? null : state.anchor
  )
}

export const clear = (): SelectionState => EMPTY_SELECTION

/** Only keep ids that still exist (after a delete, or when the data was reloaded). */
export function prune(state: SelectionState, exists: (id: RecordId) => boolean): SelectionState {
  const kept = [...state.ids].filter(exists)
  return kept.length === state.ids.size
    ? state
    : withIds(state, kept, state.anchor !== null && exists(state.anchor) ? state.anchor : null)
}

/** How much of the visible rows is selected: the header checkbox shows none, some (mixed) or all. */
export function pageState(state: SelectionState, visible: RecordId[]): 'none' | 'some' | 'all' {
  if (!visible.length) return 'none'
  const count = visible.filter(id => state.ids.has(id)).length
  return count === 0 ? 'none' : count === visible.length ? 'all' : 'some'
}

/** The header control: an unticked or partly ticked page becomes fully ticked; a fully ticked page is unticked. */
export function togglePage(state: SelectionState, visible: RecordId[]): SelectionState {
  return pageState(state, visible) === 'all' ? deselect(state, visible) : selectAll(state, visible)
}

/** Move a keyboard selection one row up or down from the focused row (Shift + arrow). */
export function extend(state: SelectionState, visible: RecordId[], from: RecordId, delta: 1 | -1): SelectionState {
  const index = visible.indexOf(from)
  const next = visible[index + delta]
  if (index < 0 || next === undefined) return state
  const ids = new Set(state.ids)
  // moving back over a row that is the end of the range un-ticks it, like a file manager
  if (ids.has(next) && ids.has(from)) ids.delete(from)
  else {
    ids.add(from)
    ids.add(next)
  }
  return withIds(state, ids, state.anchor ?? from)
}

export const sizeOf = (state: SelectionState) => state.ids.size
export const has = (state: SelectionState, id: RecordId) => state.ids.has(id)
export const toArray = (state: SelectionState): RecordId[] => [...state.ids]
