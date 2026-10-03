import { applyAdvancedFilters, readValue } from './advanced-filters.js'

function comparable(value, type = 'text') {
  if (value === null || value === undefined) return ''
  if (type === 'number' || type === 'percent') {
    const number = Number(value)
    return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY
  }
  if (type === 'date') {
    const timestamp = Date.parse(String(value))
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
  }
  if (type === 'boolean') return value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : -1
  return String(value).toLocaleLowerCase()
}

function columnValue(row, column) { return column?.getValue ? column.getValue(row) : readValue(row, column?.key) }

export function filterRecordRows(rows, { query = '', columns = [], columnFilters = {}, advanced = [] } = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  const activeColumnFilters = Object.entries(columnFilters).filter(([, value]) => String(value || '').trim())
  const byKey = new Map(columns.map(column => [column.key, column]))
  const filtered = (rows || []).filter(row => {
    if (needle && !columns.some(column => String(columnValue(row, column) ?? '').toLocaleLowerCase().includes(needle))) return false
    for (const [key, value] of activeColumnFilters) {
      if (!String(columnValue(row, byKey.get(key)) ?? '').toLocaleLowerCase().includes(String(value).toLocaleLowerCase())) return false
    }
    return true
  })
  return applyAdvancedFilters(filtered, advanced)
}

export function sortRecordRows(rows, sort = [], columns = []) {
  const fields = (Array.isArray(sort) ? sort : sort?.key ? [sort] : []).filter(item => item?.key)
  if (!fields.length) return [...(rows || [])]
  const byKey = new Map(columns.map(column => [column.key, column]))
  return [...(rows || [])].sort((left, right) => {
    for (const field of fields) {
      const column = byKey.get(field.key)
      const a = comparable(columnValue(left, column || { key: field.key }), column?.type)
      const b = comparable(columnValue(right, column || { key: field.key }), column?.type)
      const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
      if (result) return result * (field.dir === 'desc' ? -1 : 1)
    }
    return 0
  })
}

export function selectRange(currentIds, visibleIds, fromId, toId, { toggle = false } = {}) {
  const start = visibleIds.findIndex(id => String(id) === String(fromId))
  const end = visibleIds.findIndex(id => String(id) === String(toId))
  if (start < 0 || end < 0) return new Set(currentIds)
  const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1).map(String)
  const result = new Set([...currentIds].map(String))
  if (toggle && range.every(id => result.has(id))) range.forEach(id => result.delete(id))
  else range.forEach(id => result.add(id))
  return result
}

export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = [], value = '', quoted = false
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { value += '"'; index++ }
      else if (char === '"') quoted = false
      else value += char
      continue
    }
    if (char === '"' && value === '') { quoted = true; continue }
    if (char === ',') { row.push(value); value = ''; continue }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++
      row.push(value); value = ''
      if (row.some(cell => cell.trim() !== '')) rows.push(row)
      row = []
      continue
    }
    value += char
  }
  row.push(value)
  if (row.some(cell => cell.trim() !== '')) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map(header => header.trim())
  return rows.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])))
}

export function clampPage(page, pageCount) {
  return Math.min(Math.max(0, Number(page) || 0), Math.max(0, Number(pageCount) - 1))
}

export function toggleSelection(currentIds, id) {
  const next = new Set([...currentIds].map(String))
  const key = String(id)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function normalizeImportedValue(value, column) {
  if (column?.key === 'tags') return Array.isArray(value) ? value : String(value ?? '').split(/[;,]/).map(tag => tag.trim()).filter(Boolean)
  if (value === '' || value === null || value === undefined) return ''
  if (column?.type === 'number' || column?.type === 'percent') {
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  if (column?.type === 'boolean') return value === true || value === 'true' || value === '1' || String(value).toLowerCase() === 'yes'
  return value
}
