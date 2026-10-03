import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon.jsx'
import { EmptyState } from '../common.jsx'
import { LazyExportMenu as ExportMenu } from '../exports/LazyExportMenu.jsx'
import { AdvancedFilter } from '../filters/AdvancedFilter.jsx'
import { FilterChips } from '../filters/FilterChips.jsx'
import { useUserPreferences } from '../../context/user-preferences.jsx'
import { clampPage, filterRecordRows, normalizeImportedValue, parseCsv, selectRange, sortRecordRows, toggleSelection } from '../../lib/record-table.js'

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
function rowId(record) { return String(record?.numericId ?? record?.id ?? '') }
function storageKey(userId, entity) { return `atlas-table-views:v1:${String(userId || 'anonymous')}:${entity}` }
function normalizePageSize(value, fallback = 50) { return Math.max(1, Math.min(500, Number(value) || fallback)) }
function readSavedViews(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(view => view && typeof view.name === 'string' && view.config) : []
  } catch { return [] }
}
function writeSavedViews(key, views) {
  try { localStorage.setItem(key, JSON.stringify(views)); return true }
  catch { return false }
}
function defaultMapping(headers, columns) {
  const byLabel = new Map(columns.map(column => [String(column.label).trim().toLowerCase(), column.key]))
  const byKey = new Map(columns.map(column => [column.key.toLowerCase(), column.key]))
  return Object.fromEntries(headers.map(header => [header, byKey.get(header.toLowerCase()) || byLabel.get(header.trim().toLowerCase()) || '']))
}
export function RecordTable({
  entity, title, records = [], columns = [], dataset, settings, userId = '', query = {}, totalRecordCount = records.length,
  canCreate = false, canEdit = false, canBulkEdit = canEdit, canInlineEdit = canEdit, canDelete = false, canExport = true, canImport = false,
  onCreate, onOpen, onEdit, onDuplicate, onDelete, onBulkEdit, onBulkDelete, onImport, onInlineEdit,
  bulkFields = [], importFields, getDeleteImpact, getBulkDeleteImpact, advancedFilter = true, advancedFilterKey = entity, advancedConditions: controlledAdvancedConditions, onAdvancedChange, emptyTitle = 'No records yet', emptyMessage = 'Create a record or adjust your filters.', notify
}) {
  const defaults = columns.map(column => column.key)
  const columnsKey = columns.map(column => `${column.key}:${column.label}`).join('|')
  const key = storageKey(userId, entity)
  const { saveFilter } = useUserPreferences()
  const [queryText, setQueryText] = useState('')
  const [columnFilters, setColumnFilters] = useState({})
  const [localAdvancedConditions, setLocalAdvancedConditions] = useState([])
  const advancedConditions = controlledAdvancedConditions ?? localAdvancedConditions
  const changeAdvancedConditions = onAdvancedChange || setLocalAdvancedConditions
  const [sort, setSort] = useState([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(normalizePageSize(settings?.interface?.tableBehavior?.pageSize || settings?.pageSize))
  const [columnOrder, setColumnOrder] = useState(defaults)
  const [columnVisibility, setColumnVisibility] = useState(Object.fromEntries(defaults.map(column => [column, true])))
  const [columnWidths, setColumnWidths] = useState({})
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [anchorId, setAnchorId] = useState('')
  const [dragColumn, setDragColumn] = useState('')
  const [editingCell, setEditingCell] = useState(null)
  const [inlineValue, setInlineValue] = useState('')
  const [inlineError, setInlineError] = useState('')
  const [previewRecord, setPreviewRecord] = useState(null)
  const [savedViews, setSavedViews] = useState(() => readSavedViews(key))
  const [viewName, setViewName] = useState('')
  const [activeViewId, setActiveViewId] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [importRows, setImportRows] = useState([])
  const [importMap, setImportMap] = useState({})
  const [importName, setImportName] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [operationMessage, setOperationMessage] = useState('')
  const [operationError, setOperationError] = useState('')
  const tableRef = useRef(null)
  const pageSelectRef = useRef(null)
  const fileRef = useRef(null)
  const resizeCleanupRef = useRef(null)
  const dialogRef = useRef(null)
  const hasOpenDialog = Boolean(confirm || (importRows.length > 0 && importName) || previewRecord)

  useEffect(() => {
    if (!hasOpenDialog) return undefined
    const previousFocus = document.activeElement
    const timer = window.setTimeout(() => dialogRef.current?.querySelector('[data-dialog-initial]')?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
      else if (tableRef.current?.isConnected) tableRef.current.focus()
    }
  }, [hasOpenDialog])

  useEffect(() => {
    setSavedViews(readSavedViews(key))
    setActiveViewId('')
    setColumnOrder(defaults)
    setColumnVisibility(Object.fromEntries(defaults.map(column => [column, true])))
    setColumnWidths({})
    setQueryText('')
    setColumnFilters({})
    setSort([])
    setPage(0)
  // The schema key intentionally resets table defaults when an administrator changes available columns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, columnsKey])

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])
  useEffect(() => {
    const ids = new Set((records || []).map(rowId))
    setSelectedIds(current => {
      const retained = [...current].filter(id => ids.has(id))
      return retained.length === current.size ? current : new Set(retained)
    })
  }, [records])
  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map(column => [column.key, column]))
    return [...columnOrder, ...defaults.filter(column => !columnOrder.includes(column))]
      .filter(column => byKey.has(column) && columnVisibility[column] !== false)
      .map(column => byKey.get(column))
  }, [columns, columnOrder, columnVisibility, columnsKey])

  const matchingRows = useMemo(() => filterRecordRows(records, {
    query: queryText, columns, columnFilters, advanced: advancedConditions
  }), [records, queryText, columns, columnFilters, advancedConditions])
  const sortedRows = useMemo(() => sortRecordRows(matchingRows, sort, orderedColumns), [matchingRows, sort, orderedColumns])
  useEffect(() => {
    const matchingIds = new Set(matchingRows.map(rowId))
    setSelectedIds(current => {
      const retained = [...current].filter(id => matchingIds.has(id))
      return retained.length === current.size ? current : new Set(retained)
    })
  }, [matchingRows])
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = clampPage(page, pageCount)
  const visibleRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const sortedIds = sortedRows.map(rowId)
  const visibleIds = visibleRows.map(rowId)
  const selectedRecords = (records || []).filter(record => selectedIds.has(rowId(record)))
  const allPageSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
  const partiallyPageSelected = visibleIds.some(id => selectedIds.has(id)) && !allPageSelected
  const allMatchingSelected = sortedRows.length > 0 && sortedRows.every(record => selectedIds.has(rowId(record)))
  useEffect(() => { if (pageSelectRef.current) pageSelectRef.current.indeterminate = partiallyPageSelected }, [partiallyPageSelected])
  const bulkDeleteImpacts = selectedRecords.map(record => getDeleteImpact?.(record)).filter(Boolean)
  const bulkDeleteImpact = getBulkDeleteImpact?.(selectedRecords) || bulkDeleteImpacts.slice(0, 3).join(' ') + (bulkDeleteImpacts.length > 3 ? ` Plus ${bulkDeleteImpacts.length - 3} additional linked-record warning(s).` : '')
  const focusConditions = useCallback(conditions => changeAdvancedConditions(conditions), [changeAdvancedConditions])

  useEffect(() => { setPage(0) }, [records, queryText, columnFilters, advancedConditions, sort, pageSize])

  const sortBy = (column, event) => {
    setSort(current => {
      const found = current.find(item => item.key === column.key)
      const nextDirection = !found ? 'asc' : found.dir === 'asc' ? 'desc' : ''
      if (!event.shiftKey) return nextDirection ? [{ key: column.key, dir: nextDirection }] : []
      const rest = current.filter(item => item.key !== column.key)
      return nextDirection ? [...rest, { key: column.key, dir: nextDirection }] : rest
    })
  }
  const moveColumn = target => {
    if (!dragColumn || dragColumn === target) return
    setColumnOrder(current => {
      const from = current.indexOf(dragColumn), to = current.indexOf(target)
      if (from < 0 || to < 0) return current
      const next = [...current]
      next.splice(from, 1)
      next.splice(to, 0, dragColumn)
      return next
    })
    setDragColumn('')
  }
  const moveColumnByKeyboard = (key, direction) => {
    const visibleKeys = orderedColumns.map(column => column.key)
    const position = visibleKeys.indexOf(key)
    const target = visibleKeys[position + direction]
    if (position < 0 || !target) return
    setColumnOrder(current => {
      const next = [...current]
      const from = next.indexOf(key), to = next.indexOf(target)
      if (from < 0 || to < 0) return current
      next.splice(from, 1)
      next.splice(to, 0, key)
      return next
    })
  }
  const resizeColumnByKeyboard = (event, column) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const currentWidth = columnWidths[column.key] || event.currentTarget.parentElement.getBoundingClientRect().width
    const delta = event.key === 'ArrowRight' ? 16 : -16
    setColumnWidths(current => ({ ...current, [column.key]: Math.max(100, Math.min(640, (current[column.key] || currentWidth) + delta)) }))
  }
  const resizeColumn = (event, column) => {
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = columnWidths[column.key] || event.currentTarget.parentElement.getBoundingClientRect().width
    const move = moveEvent => setColumnWidths(current => ({ ...current, [column.key]: Math.max(100, Math.min(640, startWidth + moveEvent.clientX - startX)) }))
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      resizeCleanupRef.current = null
    }
    resizeCleanupRef.current = stop
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop, { once: true })
  }
  const selectVisible = () => {
    if (busy) return
    setSelectedIds(current => {
      const next = new Set(current)
      if (allPageSelected) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))
      return next
    })
  }
  const selectMatching = () => {
    if (busy) return
    setSelectedIds(current => {
      const next = new Set(current)
      if (allMatchingSelected) sortedRows.forEach(record => next.delete(rowId(record)))
      else sortedRows.forEach(record => next.add(rowId(record)))
      return next
    })
  }
  const selectRecord = (record, event = {}) => {
    if (busy) return
    const id = rowId(record)
    if (event.shiftKey && anchorId) {
      setSelectedIds(current => selectRange(current, sortedIds, anchorId, id, { toggle: true }))
    } else setSelectedIds(current => toggleSelection(current, id))
    setAnchorId(id)
  }
  const clearSelection = () => { setSelectedIds(new Set()); setAnchorId('') }
  const keepFailedSelection = result => {
    const failures = Array.isArray(result?.failures) ? result.failures : []
    if (!failures.length) { clearSelection(); return }
    const failedIds = new Set(failures.map(failure => String(failure.id ?? '')))
    setSelectedIds(new Set(selectedRecords.filter(record => failedIds.has(rowId(record))).map(rowId)))
    setAnchorId('')
  }

  const currentConfig = () => ({
    queryText, columnFilters, sort, pageSize, columnOrder, columnVisibility, columnWidths, advancedConditions
  })
  const applyConfig = config => {
    if (!config || typeof config !== 'object') return
    setQueryText(String(config.queryText || ''))
    setColumnFilters(config.columnFilters || {})
    setSort(Array.isArray(config.sort) ? config.sort : [])
    setPageSize(normalizePageSize(config.pageSize))
    setColumnOrder(Array.isArray(config.columnOrder) ? config.columnOrder : defaults)
    setColumnVisibility(config.columnVisibility || Object.fromEntries(defaults.map(column => [column, true])))
    setColumnWidths(config.columnWidths || {})
    if (Array.isArray(config.advancedConditions)) {
      changeAdvancedConditions(config.advancedConditions)
      saveFilter(advancedFilterKey, config.advancedConditions).catch(error => setOperationError(error.message || 'The saved filter could not be updated.'))
    }
    setPage(0)
  }
  const saveView = () => {
    const name = viewName.trim()
    if (!name) { setOperationError('Enter a name for this saved view.'); return }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const next = [...savedViews.filter(view => view.name !== name), { id, name, config: currentConfig() }]
    if (!writeSavedViews(key, next)) { setOperationError('Browser storage is unavailable; this view was not saved.'); return }
    setSavedViews(next)
    setActiveViewId(id)
    setViewName('')
    setOperationError('')
    setOperationMessage(`View “${name}” saved on this browser.`)
  }
  const resetView = () => {
    setQueryText(''); setColumnFilters({}); changeAdvancedConditions([]); setSort([]); setPage(0)
    saveFilter(advancedFilterKey, []).catch(error => setOperationError(error.message || 'Advanced filters could not be reset.'))
    setPageSize(normalizePageSize(settings?.interface?.tableBehavior?.pageSize || settings?.pageSize))
    setColumnOrder(defaults); setColumnVisibility(Object.fromEntries(defaults.map(column => [column, true]))); setColumnWidths({})
    setActiveViewId('')
    clearSelection()
    setOperationMessage('Current view settings reset. Saved views were kept.')
  }
  const deleteSavedView = () => {
    if (!activeViewId) return
    const next = savedViews.filter(view => view.id !== activeViewId)
    if (!writeSavedViews(key, next)) { setOperationError('Browser storage is unavailable; the saved view was not deleted.'); return }
    const removed = savedViews.find(view => view.id === activeViewId)
    setSavedViews(next); setActiveViewId('')
    setOperationMessage(`Saved view “${removed?.name || ''}” deleted from this browser.`)
  }
  const run = async (label, total, action) => {
    if (busy) return null
    setBusy(true); setProgress({ current: 0, total: Math.max(1, total), label }); setOperationMessage(''); setOperationError('')
    try {
      const result = await action(current => setProgress(value => ({ ...value, current: Math.max(0, Math.min(total, Number(current) || 0)) })))
      const affected = Number(result?.affected ?? result?.successCount ?? result?.succeeded ?? 0)
      const failures = Array.isArray(result?.failures) ? result.failures : []
      const queued = Number(result?.offlineQueuedCount) || 0
      setOperationMessage(failures.length ? `${affected} of ${total} records processed; ${failures.length} need attention.` : queued ? `${affected} changes are saved on this device; ${queued} will sync when the local host is reachable.` : `${affected} ${entity} record${affected === 1 ? '' : 's'} processed.`)
      if (failures.length) setOperationError(failures.slice(0, 3).map(failure => `${failure.id || ''}: ${failure.error || 'failed'}`).join(' · '))
      if (typeof notify === 'function') notify({ title: failures.length ? 'Operation partially completed' : queued ? 'Changes queued for sync' : 'Operation completed', body: failures.length ? `${affected} succeeded; ${failures.length} failed.` : queued ? `${queued} changes are saved locally and will sync when the host returns.` : `${affected} record${affected === 1 ? '' : 's'} affected.`, tone: failures.length || queued ? 'warning' : 'success' })
      return result
    } catch (error) {
      setOperationError(error?.message || `${label} failed.`)
      if (typeof notify === 'function') notify({ title: `${label} failed`, body: error?.message || 'Try again.', tone: 'warning' })
      return null
    } finally { setBusy(false); setProgress({ current: 0, total: 0, label: '' }) }
  }
  const openBulkEdit = field => {
    if (!selectedRecords.length || !onBulkEdit) return
    const target = bulkFields.find(item => item.key === field) || bulkFields[0]
    if (!target) return
    setBulkField(target.key)
    setBulkValue(target.type === 'tags' ? '' : target.defaultValue ?? '')
    setConfirm({ kind: 'bulk-edit', field: target.key })
  }
  const confirmBulkEdit = async () => {
    const field = bulkFields.find(item => item.key === bulkField)
    if (!field) return
    const ids = selectedRecords.map(rowId)
    setConfirm(null)
    const result = await run('Bulk edit', ids.length, report => onBulkEdit({ field: bulkField, value: normalizeImportedValue(bulkValue, field), records: selectedRecords, ids, reportProgress: report }))
    if (result) { keepFailedSelection(result); requestAnimationFrame(() => tableRef.current?.focus()) }
  }
  const askBulkDelete = () => setConfirm({ kind: 'bulk-delete' })
  const confirmBulkDelete = async () => {
    const ids = selectedRecords.map(rowId)
    setConfirm(null)
    const result = await run('Bulk delete', ids.length, report => onBulkDelete({ records: selectedRecords, ids, reportProgress: report }))
    if (result) { keepFailedSelection(result); requestAnimationFrame(() => tableRef.current?.focus()) }
  }
  const askSingleDelete = record => setConfirm({ kind: 'single-delete', record })
  const confirmSingleDelete = async () => {
    const record = confirm.record
    setConfirm(null)
    const result = await run('Delete', 1, async report => {
      const response = await onDelete(record, { confirmed: true })
      if (response === false) return { affected: 0, failures: [{ id: rowId(record), error: 'Deletion was cancelled' }] }
      report(1)
      return { affected: 1, offlineQueuedCount: response?.offlineQueued ? 1 : 0, failures: [] }
    })
    if (result?.affected) {
      clearSelection()
      requestAnimationFrame(() => tableRef.current?.focus())
    }
  }
  const openRecord = record => { if (onOpen) onOpen(record); else setPreviewRecord(record) }
  const duplicateRecord = async record => {
    if (!onDuplicate) return
    try { await onDuplicate(record) } catch (error) { setOperationError(error?.message || 'Copy could not be opened.') }
  }
  const saveInline = async (record, column) => {
    const value = normalizeImportedValue(inlineValue, column)
    try {
      const result = await onInlineEdit?.(record, column.key, value)
      setEditingCell(null); setInlineError('')
      const message = result?.offlineQueued ? 'Inline change saved offline and queued to sync.' : 'Inline change saved.'
      setOperationMessage(message)
      notify?.({ title: result?.offlineQueued ? 'Edit queued for sync' : 'Changes saved', body: `${column.label} updated for ${displayValue(record[columns[0]?.key] || record.title || record.name || rowId(record))}.`, tone: result?.offlineQueued ? 'warning' : 'success' })
    } catch (error) {
      const message = error.message || 'This field could not be saved.'
      setInlineError(message)
      notify?.({ title: 'Inline edit failed', body: message, tone: 'warning' })
    }
  }
  const inlineAllowed = (record, column) => typeof canInlineEdit === 'function' ? Boolean(canInlineEdit(record, column)) : Boolean(canInlineEdit)
  const beginInline = (record, column) => {
    if (busy || !inlineAllowed(record, column) || !column.inlineEditable || !onInlineEdit) return
    setEditingCell({ id: rowId(record), key: column.key })
    const value = column.getValue ? column.getValue(record) : String(column.key).split('.').reduce((current, key) => current?.[key], record)
    setInlineValue(value ?? '')
    setInlineError('')
  }
  const trapDialogFocus = event => {
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])]
    if (!focusable.length) { event.preventDefault(); return }
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }
  const handleKeyboard = event => {
    const target = event.target
    const textInput = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
    const meta = event.metaKey || event.ctrlKey
    if (event.key === 'Escape' && hasOpenDialog) {
      event.preventDefault()
      event.stopPropagation()
      if (confirm) setConfirm(null)
      else if (importRows.length && importName) { setImportRows([]); setImportName('') }
      else setPreviewRecord(null)
      return
    }
    if (meta && event.key.toLowerCase() === 'a' && !textInput && !hasOpenDialog) { event.preventDefault(); selectMatching() }
    if (event.key === 'Escape' && !hasOpenDialog && !busy) clearSelection()
    if (event.key === 'Delete' && selectedRecords.length && canDelete && !busy && !textInput && !hasOpenDialog) {
      event.preventDefault()
      if (selectedRecords.length === 1) askSingleDelete(selectedRecords[0])
      else askBulkDelete()
    }
  }
  const startImport = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setOperationError(''); setOperationMessage('')
    if (file.size > 50 * 1024 * 1024) {
      const message = 'Import files must be 50 MB or smaller.'
      setOperationError(message)
      notify?.({ title: 'Import failed', body: message, tone: 'warning' })
      return
    }
    try {
      const text = await file.text()
      const parsed = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text)
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null
      if (!rows || !rows.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Choose a JSON array or a CSV file with a header row.')
      const headers = [...new Set(rows.flatMap(row => Object.keys(row)))]
      setImportRows(rows)
      setImportMap(defaultMapping(headers, importableFields))
      setImportName(file.name)
    } catch (error) {
      const message = error.message || 'This import file could not be read.'
      setOperationError(message)
      notify?.({ title: 'Import failed', body: message, tone: 'warning' })
    }
  }
  const confirmImport = async () => {
    const headers = Object.keys(importMap)
    const mapped = importRows.map(row => Object.fromEntries(headers.filter(header => importMap[header]).map(header => {
      const key = importMap[header]
      const column = importableFields.find(item => item.key === key)
      return [key, normalizeImportedValue(row[header], column)]
    }))).filter(row => Object.keys(row).length)
    if (!mapped.length) { setOperationError('Map at least one input column to a record field.'); return }
    const sourceName = importName
    const sourceRows = importRows
    setImportName('')
    setConfirm(null)
    const result = await run('Import', mapped.length, report => onImport?.(mapped, report))
    if (!result) { setImportRows(sourceRows); setImportName(sourceName); return }
    const failedIndexes = new Set((result.failures || []).map(failure => Number(failure.rowIndex)).filter(index => Number.isInteger(index) && index >= 0 && index < sourceRows.length))
    if (failedIndexes.size) {
      setImportRows(sourceRows.filter((_, index) => failedIndexes.has(index)))
      setImportName(`${sourceName} · failed rows`)
    } else { setImportRows([]); setImportName('') }
  }
  const visibleFields = orderedColumns
  const importableFields = importFields || columns.filter(column => column.importable !== false)
  const scopeRows = { selected: selectedRecords, filtered: sortedRows, all: records }

  return <section className="record-table-shell" ref={tableRef} tabIndex={0} onKeyDown={handleKeyboard} aria-label={`${title} table controls`} aria-busy={busy}>
    <div className="record-table-toolbar">
      <div className="record-table-search"><Icon name="search" size={15}/><input aria-label={`Search ${title}`} value={queryText} onChange={event => setQueryText(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`}/></div>
      {advancedFilter && <AdvancedFilter filterKey={advancedFilterKey} fields={columns} onApply={focusConditions} appliedConditions={advancedConditions}/>}
      {advancedFilter && <FilterChips filterKey={entity} conditions={advancedConditions} fields={columns} onChange={changeAdvancedConditions}/>}
      <details className="record-column-menu"><summary><Icon name="settings" size={14}/> Columns</summary><div>{columns.map(column => <label key={column.key}><input type="checkbox" checked={columnVisibility[column.key] !== false} onChange={() => setColumnVisibility(current => ({ ...current, [column.key]: current[column.key] === false }))}/>{column.label}</label>)}</div></details>
      <label className="record-page-size">Rows<select value={pageSize} onChange={event => setPageSize(normalizePageSize(event.target.value))}>{[...new Set([10, 25, 50, 100, 250, 500, pageSize])].sort((left, right) => left - right).map(size => <option value={size} key={size}>{size}</option>)}</select></label>
      <select className="record-view-select" aria-label="Saved table view" value={activeViewId} onChange={event => { const view = savedViews.find(item => item.id === event.target.value); setActiveViewId(event.target.value); if (view) applyConfig(view.config) }}><option value="">Default view</option>{savedViews.map(view => <option value={view.id} key={view.id}>{view.name}</option>)}</select>
      <input className="record-view-name" value={viewName} onChange={event => setViewName(event.target.value)} placeholder="Save view as…" aria-label="Saved view name" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveView() } }}/>
      <button type="button" className="secondary-button record-small-action" onClick={saveView} disabled={busy}>Save view</button>
      <button type="button" className="secondary-button record-small-action" onClick={resetView} disabled={busy}>Reset view</button><button type="button" className="text-button record-small-action" onClick={deleteSavedView} disabled={busy || !activeViewId}>Delete saved</button>
    </div>
    <div className="record-selection-toolbar">
      <span className="record-selection-count" role="status" aria-live="polite"><strong>{selectedRecords.length}</strong> selected</span>
      <button type="button" className="text-button" onClick={selectVisible} disabled={busy || !visibleRows.length}>{allPageSelected ? 'Deselect page' : `Select page (${visibleRows.length})`}</button>
      <button type="button" className="text-button" onClick={selectMatching} disabled={busy || !sortedRows.length}>{allMatchingSelected ? 'Deselect matching' : `Select all matching (${sortedRows.length})`}</button>
      {selectedRecords.length === 1 && <>
        <button type="button" className="secondary-button" onClick={() => openRecord(selectedRecords[0])} disabled={busy}><Icon name="eye" size={14}/> Open</button>
        {canEdit && <button type="button" className="secondary-button" onClick={() => onEdit?.(selectedRecords[0])} disabled={busy}><Icon name="edit" size={14}/> Edit</button>}
        {canCreate && <button type="button" className="secondary-button" onClick={() => duplicateRecord(selectedRecords[0])} disabled={busy}><Icon name="copy" size={14}/> Duplicate</button>}
        {canDelete && <button type="button" className="secondary-button danger-button" onClick={() => askSingleDelete(selectedRecords[0])} disabled={busy}><Icon name="trash" size={14}/> Delete</button>}
      </>}
      {selectedRecords.length > 1 && <>
        {canBulkEdit && bulkFields.length > 0 && <button type="button" className="secondary-button" onClick={() => openBulkEdit('')} disabled={busy}><Icon name="edit" size={14}/> Bulk edit</button>}
        {bulkFields.some(field => field.key === 'assigneeId') && canBulkEdit && <button type="button" className="secondary-button" onClick={() => openBulkEdit('assigneeId')} disabled={busy}>Assign</button>}
        {bulkFields.some(field => field.key === 'status') && canBulkEdit && <button type="button" className="secondary-button" onClick={() => openBulkEdit('status')} disabled={busy}>Change status</button>}
        {bulkFields.some(field => field.key === 'tags') && canBulkEdit && <button type="button" className="secondary-button" onClick={() => openBulkEdit('tags')} disabled={busy}>Tag / categorize</button>}
        {canDelete && <button type="button" className="secondary-button danger-button" onClick={askBulkDelete} disabled={busy}><Icon name="trash" size={14}/> Delete {selectedRecords.length}</button>}
      </>}
      <span className="record-toolbar-spacer"/>
      {canCreate && <button type="button" className="primary-button" onClick={onCreate} disabled={busy}><Icon name="plus" size={14}/> Add {entity}</button>}
      {canImport && <><input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={startImport}/><button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={14}/> Import</button></>}
      {dataset && <ExportMenu dataset={dataset} rows={sortedRows} columns={columns} title={title} settings={settings} query={query} canExport={canExport} canPrint={canExport} exportScopes={scopeRows}/>}
    </div>
    <div className="record-table-meta"><span><strong>{sortedRows.length.toLocaleString()}</strong> matching of {Number(totalRecordCount || 0).toLocaleString()} records</span><span>Arrow keys move rows · Space selects · Shift-click selects a range · Ctrl/Cmd-click toggles · Ctrl/Cmd+A selects matching · Delete asks before removal</span></div>
    {busy && <div className="record-progress" role="status"><span>{progress.label} · {progress.current.toLocaleString()} / {progress.total.toLocaleString()}</span><progress max={progress.total || 1} value={progress.current}/></div>}
    {operationMessage && <div className="record-feedback success" role="status">{operationMessage}</div>}
    {operationError && <div className="record-feedback error" role="alert"><Icon name="warning" size={14}/>{operationError}</div>}
    <div className="record-table-scroll">
      <table className="record-table" aria-label={`${title} records`}>
        <colgroup><col className="record-select-col"/>{visibleFields.map(column => <col key={column.key} style={columnWidths[column.key] ? { width: `${columnWidths[column.key]}px` } : undefined}/>)}<col className="record-actions-col"/></colgroup>
        <thead>
          <tr>
            <th className="record-select-head"><input ref={pageSelectRef} type="checkbox" aria-label="Select all records on this page" aria-checked={partiallyPageSelected ? 'mixed' : allPageSelected} checked={allPageSelected} onChange={selectVisible} disabled={busy || !visibleIds.length}/></th>
            {visibleFields.map(column => {
              const sortIndex = sort.findIndex(item => item.key === column.key)
              return <th key={column.key} aria-sort={sortIndex < 0 ? 'none' : sort[sortIndex].dir === 'asc' ? 'ascending' : 'descending'} draggable onDragStart={() => setDragColumn(column.key)} onDragOver={event => event.preventDefault()} onDrop={() => moveColumn(column.key)} className={dragColumn === column.key ? 'is-dragging' : ''}>
                <button type="button" className="record-sort-button" onClick={event => sortBy(column, event)} onKeyDown={event => { if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveColumnByKeyboard(column.key, event.key === 'ArrowRight' ? 1 : -1) } }} title="Click to sort; Shift-click to add another sort column. Alt+Left/Right moves this column"><span>{column.label}</span><span className="record-sort-indicator" aria-hidden="true">{sortIndex >= 0 ? `${sort[sortIndex].dir === 'asc' ? '▲' : '▼'} ${sortIndex + 1}` : '↕'}</span></button>
                <span className="record-resize-handle" role="separator" aria-orientation="vertical" tabIndex={0} aria-valuemin={100} aria-valuemax={640} aria-valuenow={Math.round(columnWidths[column.key] || 160)} aria-label={`Resize ${column.label} column; use Left and Right Arrow keys`} onKeyDown={event => resizeColumnByKeyboard(event, column)} onPointerDown={event => resizeColumn(event, column)}/>
              </th>
            })}
            <th className="record-actions-head">Actions</th>
          </tr>
          <tr className="record-filter-row"><th><button type="button" className="text-button" aria-label="Clear all column filters" onClick={() => setColumnFilters({})}>Clear</button></th>{visibleFields.map(column => <th key={column.key}><input aria-label={`Filter ${column.label}`} value={columnFilters[column.key] || ''} onChange={event => setColumnFilters(current => ({ ...current, [column.key]: event.target.value }))} placeholder="Filter…"/></th>)}<th/></tr>
        </thead>
        <tbody>
          {visibleRows.map(record => {
            const id = rowId(record)
            const selected = selectedIds.has(id)
            return <tr key={id} className={selected ? 'is-selected' : ''} aria-selected={selected} aria-keyshortcuts="ArrowUp ArrowDown Home End Space Enter Delete" tabIndex={0} onClick={event => {
              if (event.target.closest('button, input, select, textarea, a')) return
              if (event.shiftKey || event.metaKey || event.ctrlKey) selectRecord(record, event)
              else openRecord(record)
            }} onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const rows = [...(tableRef.current?.querySelectorAll('tbody tr[tabindex="0"]') || [])]
                const currentIndex = rows.indexOf(event.currentTarget)
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : currentIndex + (event.key === 'ArrowDown' ? 1 : -1)
                rows[nextIndex]?.focus()
                return
              }
              if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); selectRecord(record, event) }
              if (event.key === 'Enter') { event.preventDefault(); openRecord(record) }
              if (event.key === 'Delete' && canDelete && !busy) {
                event.preventDefault(); event.stopPropagation()
                if (selected && selectedRecords.length > 1) askBulkDelete()
                else { setSelectedIds(current => new Set([...current, id])); setConfirm({ kind: 'single-delete', record }) }
              }
            }}>
              <td className="record-select-cell"><input type="checkbox" aria-label={`Select ${displayValue(record[columns[0]?.key] || record.title || record.name || id)}`} checked={selected} disabled={busy} onClick={event => event.stopPropagation()} onChange={event => selectRecord(record, event.nativeEvent)}/></td>
              {visibleFields.map(column => {
                const value = column.getValue ? column.getValue(record) : String(column.key).split('.').reduce((current, key) => current?.[key], record)
                const cellEditing = editingCell?.id === id && editingCell?.key === column.key
                return <td key={column.key} onDoubleClick={() => beginInline(record, column)} title={column.inlineEditable && inlineAllowed(record, column) ? 'Double-click to edit this field inline' : undefined}>
                  {cellEditing ? <div className="record-inline-editor">{column.inlineOptions ? <select autoFocus value={inlineValue} onChange={event => setInlineValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveInline(record, column); if (event.key === 'Escape') setEditingCell(null) }}><option value="">Choose…</option>{column.inlineOptions.map(option => { const value = Array.isArray(option) ? option[0] : option; const label = Array.isArray(option) ? option[1] : option; return <option key={value} value={value}>{label}</option> })}</select> : <input autoFocus type={column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'} value={inlineValue} onChange={event => setInlineValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveInline(record, column); if (event.key === 'Escape') setEditingCell(null) }}/>}<button type="button" aria-label="Save inline edit" onClick={() => saveInline(record, column)}><Icon name="check" size={13}/></button><button type="button" aria-label="Cancel inline edit" onClick={() => setEditingCell(null)}><Icon name="close" size={13}/></button>{inlineError && <small role="alert">{inlineError}</small>}</div>
                    : column.render ? column.render(record, value) : displayValue(value)}
                </td>
              })}
              <td className="record-row-actions"><button type="button" title="Open record" aria-label={`Open ${title} record`} onClick={() => openRecord(record)} disabled={busy}><Icon name="eye" size={14}/></button>{canEdit && <button type="button" title="Edit record" aria-label={`Edit ${title} record`} onClick={() => onEdit?.(record)} disabled={busy}><Icon name="edit" size={14}/></button>}{canCreate && <button type="button" title="Duplicate record" aria-label={`Duplicate ${title} record`} onClick={() => duplicateRecord(record)} disabled={busy}><Icon name="copy" size={14}/></button>}{canDelete && <button type="button" title="Delete record" aria-label={`Delete ${title} record`} onClick={() => askSingleDelete(record)} disabled={busy}><Icon name="trash" size={14}/></button>}</td>
            </tr>
          })}
          {!visibleRows.length && <tr><td colSpan={visibleFields.length + 2}><EmptyState title={Number(totalRecordCount || 0) > 0 ? 'No results match' : emptyTitle} message={Number(totalRecordCount || 0) > 0 ? 'Clear a page filter, search term, column filter, or advanced condition.' : emptyMessage}/></td></tr>}
        </tbody>
      </table>
    </div>
    <div className="record-table-pagination"><span>Showing {sortedRows.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, sortedRows.length)} of {sortedRows.length.toLocaleString()}</span><div><button className="secondary-button" disabled={currentPage === 0 || busy} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary-button" disabled={currentPage >= pageCount - 1 || busy} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>

    {confirm?.kind === 'bulk-edit' && <div className="record-modal-backdrop" role="presentation"><section ref={dialogRef} onKeyDown={trapDialogFocus} className="record-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="record-bulk-edit-title" aria-describedby="record-bulk-edit-description"><header><h3 id="record-bulk-edit-title">Bulk edit {selectedRecords.length} records</h3><button type="button" className="icon-button" onClick={() => setConfirm(null)} aria-label="Close bulk edit"><Icon name="close" size={16}/></button></header><p id="record-bulk-edit-description">This change will be attempted only on the {selectedRecords.length} records you selected. Existing validation and role checks still apply.</p><label>Field<select data-dialog-initial value={bulkField} onChange={event => { setBulkField(event.target.value); setBulkValue('') }}>{bulkFields.map(field => <option value={field.key} key={field.key}>{field.label}</option>)}</select></label>{(() => { const field = bulkFields.find(item => item.key === bulkField); if (!field) return null; if (field.type === 'select' || field.type === 'boolean') return <label>{field.label}<select value={bulkValue} onChange={event => setBulkValue(event.target.value)}><option value="">Choose…</option>{field.options?.map(option => <option key={Array.isArray(option) ? option[0] : option} value={Array.isArray(option) ? option[0] : option}>{Array.isArray(option) ? option[1] : option}</option>)}</select></label>; return <label>{field.label}<input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={bulkValue} onChange={event => setBulkValue(event.target.value)} placeholder={field.type === 'tags' ? 'Comma-separated tags' : ''}/>{field.type === 'tags' && <small>Leave empty to clear tags on the selected records.</small>}</label> })()}<div className="record-confirm-actions"><button type="button" className="secondary-button" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="primary-button" onClick={confirmBulkEdit} disabled={!bulkField || (bulkValue === '' && bulkFields.find(field => field.key === bulkField)?.type !== 'tags')}>Apply to {selectedRecords.length} records</button></div></section></div>}
    {(confirm?.kind === 'bulk-delete' || confirm?.kind === 'single-delete') && <div className="record-modal-backdrop" role="presentation"><section ref={dialogRef} onKeyDown={trapDialogFocus} className="record-confirm-modal danger" role="alertdialog" aria-modal="true" aria-labelledby="record-delete-title" aria-describedby="record-delete-warning"><header><h3 id="record-delete-title">Delete {confirm.kind === 'bulk-delete' ? selectedRecords.length : 1} {entity} record{confirm.kind === 'bulk-delete' && selectedRecords.length !== 1 ? 's' : ''}?</h3><button type="button" className="icon-button" onClick={() => setConfirm(null)} aria-label="Cancel deletion"><Icon name="close" size={16}/></button></header><p id="record-delete-warning">This deletion has no per-record undo. An administrator can restore an earlier full-workspace database backup, which also rolls back other changes. Make a backup first if you may need recovery.{confirm.kind === 'bulk-delete' ? ` Only the ${selectedRecords.length} selected records will be sent for deletion.` : ''}{confirm.kind === 'single-delete' && getDeleteImpact?.(confirm.record) ? ` ${getDeleteImpact(confirm.record)}` : ''}{confirm.kind === 'bulk-delete' && bulkDeleteImpact ? ` ${bulkDeleteImpact}` : ''}</p><div className="record-confirm-actions"><button type="button" data-dialog-initial className="secondary-button" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="primary-button danger-confirm" onClick={confirm.kind === 'bulk-delete' ? confirmBulkDelete : confirmSingleDelete}>Delete {confirm.kind === 'bulk-delete' ? selectedRecords.length : 1}</button></div></section></div>}
    {importRows.length > 0 && importName && <div className="record-modal-backdrop" role="presentation"><section ref={dialogRef} onKeyDown={trapDialogFocus} className="record-confirm-modal record-import-modal" role="dialog" aria-modal="true" aria-labelledby="record-import-title"><header><h3 id="record-import-title">Import {importRows.length.toLocaleString()} {entity} records</h3><button type="button" className="icon-button" onClick={() => { setImportRows([]); setImportName('') }} data-dialog-initial aria-label="Cancel import"><Icon name="close" size={16}/></button></header><p>{importName}. Map source headers to Atlas fields. Rows are validated individually; successful rows are reported separately from failures.</p><div className="record-import-map">{Object.keys(importMap).map(header => <label key={header}><span>{header}</span><select value={importMap[header]} onChange={event => setImportMap(current => ({ ...current, [header]: event.target.value }))}><option value="">Ignore column</option>{importableFields.map(column => <option value={column.key} key={column.key}>{column.label}</option>)}</select></label>)}</div><p className="record-irreversible-warning">Importing creates new records; duplicates are not automatically deduplicated.</p><div className="record-confirm-actions"><button type="button" className="secondary-button" onClick={() => { setImportRows([]); setImportName('') }}>Cancel</button><button type="button" className="primary-button" onClick={confirmImport} disabled={busy || !onImport}>Import {importRows.length.toLocaleString()}</button></div></section></div>}
    {previewRecord && <div className="record-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewRecord(null) }}><section ref={dialogRef} onKeyDown={trapDialogFocus} className="record-confirm-modal record-preview-modal" role="dialog" aria-modal="true" aria-labelledby="record-preview-title"><header><h3 id="record-preview-title">{title} record</h3><button type="button" className="icon-button" onClick={() => setPreviewRecord(null)} data-dialog-initial aria-label="Close record"><Icon name="close" size={16}/></button></header><dl>{columns.map(column => <React.Fragment key={column.key}><dt>{column.label}</dt><dd>{displayValue(column.getValue ? column.getValue(previewRecord) : String(column.key).split('.').reduce((current, key) => current?.[key], previewRecord))}</dd></React.Fragment>)}</dl><div className="record-confirm-actions"><button type="button" className="secondary-button" onClick={() => setPreviewRecord(null)}>Close</button>{canEdit && <button type="button" className="primary-button" onClick={() => { const record = previewRecord; setPreviewRecord(null); onEdit?.(record) }}>Edit record</button>}</div></section></div>}
  </section>
}
