import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { COLLECTIONS } from './schema.js'

const BASE_COLUMNS = ['id', 'id_type', 'ordinal', 'attributes_json', 'present_json', 'field_states_json', 'row_hash']
const QUOTE = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`
const snakeCase = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
const TABLES_IN_WRITE_ORDER = ['teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'users', 'workLogs', 'auditLogs']
const TABLES_IN_DELETE_ORDER = [...TABLES_IN_WRITE_ORDER].reverse()

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function json(value) { return JSON.stringify(canonicalize(value)) }
function jsonParse(value, fallback) {
  if (value === null || value === undefined) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function typeName(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return typeof value
}

function valueForSql(value, spec, fieldName) {
  if (value === undefined || value === null) return null
  if (spec.type === 'JSON') return JSON.stringify(value)
  if (spec.type === 'REFERENCE') {
    if (value === '') return null
    if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${fieldName} must be a string, number, null, or empty value`)
    return String(value)
  }
  if (spec.type === 'BOOLEAN') {
    if (value === true || value === 1) return 1
    if (value === false || value === 0) return 0
    throw new TypeError(`${fieldName} must be boolean`)
  }
  if (spec.type === 'REAL' || spec.type === 'INTEGER') {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite numeric data`)
    if (spec.type === 'INTEGER' && !Number.isInteger(number)) throw new TypeError(`${fieldName} must be an integer`)
    return number
  }
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be text`)
  return value
}

function rowForRecord(collection, record, ordinal) {
  const definition = COLLECTIONS[collection]
  if (!definition) throw new Error(`Unknown collection: ${collection}`)
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`${collection}[${ordinal}] must be an object`)
  if (typeof record.id !== 'string' && typeof record.id !== 'number') throw new TypeError(`${collection}[${ordinal}] requires a string or number id`)

  const fields = definition.fields
  const knownFieldNames = new Set(Object.keys(fields))
  const attributes = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id' && !knownFieldNames.has(key)))
  const row = {
    id: String(record.id),
    id_type: typeof record.id,
    ordinal,
    attributes_json: json(attributes),
    present_json: json(Object.keys(record).filter((key) => key === 'id' || knownFieldNames.has(key))),
    field_states_json: '{}'
  }
  const fieldStates = {}
  for (const [property, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(record, property)) continue
    const value = record[property]
    if (value === null || value === undefined) fieldStates[property] = typeName(value)
    else if (spec.type === 'REFERENCE') fieldStates[property] = value === '' ? 'empty' : typeof value
    row[snakeCase(property)] = valueForSql(value, spec, `${collection}.${property}`)
  }
  row.field_states_json = json(fieldStates)
  const fingerprintSource = json({ record, ordinal })
  row.row_hash = digest(fingerprintSource)
  return row
}

function recordForRow(collection, row) {
  const definition = COLLECTIONS[collection]
  const present = new Set(jsonParse(row.present_json, []))
  const states = jsonParse(row.field_states_json, {})
  const record = jsonParse(row.attributes_json, {})
  record.id = row.id_type === 'number' ? Number(row.id) : row.id
  for (const [property, spec] of Object.entries(definition.fields)) {
    if (!present.has(property)) continue
    const state = states[property]
    if (state === 'undefined') { record[property] = undefined; continue }
    if (state === 'null') { record[property] = null; continue }
    if (state === 'empty') { record[property] = ''; continue }
    const value = row[snakeCase(property)]
    if (spec.type === 'JSON') record[property] = jsonParse(value, null)
    else if (spec.type === 'BOOLEAN') record[property] = value === null ? null : Boolean(value)
    else if (spec.type === 'REAL' || spec.type === 'INTEGER') record[property] = value === null ? null : Number(value)
    else if (spec.type === 'REFERENCE' && state === 'number') record[property] = value === null ? null : Number(value)
    else record[property] = value
  }
  return record
}

function tableName(collection) { return COLLECTIONS[collection].table || collection }
function insertSql(collection) {
  const definition = COLLECTIONS[collection]
  const table = QUOTE(tableName(collection))
  const fields = Object.keys(definition.fields).map(snakeCase)
  const columns = ['id', 'id_type', 'ordinal', ...fields, 'attributes_json', 'present_json', 'field_states_json', 'row_hash']
  const placeholders = columns.map(() => '?').join(', ')
  const assignments = columns.slice(1).map((column) => `${QUOTE(column)} = excluded.${QUOTE(column)}`).join(', ')
  return { columns, sql: `INSERT INTO ${table} (${columns.map(QUOTE).join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${assignments} WHERE ${table}.row_hash <> excluded.row_hash` }
}

export class SqliteStoreRepository {
  constructor(db, { filePath, dataDirectory, backupRetention = 25 } = {}) {
    this.db = db
    this.filePath = filePath
    this.dataDirectory = dataDirectory || path.dirname(filePath)
    this.backupRetention = backupRetention
    this.insertStatements = new Map()
    this.deleteStatements = new Map()
  }

  hasSnapshot() {
    return Boolean(this.db.prepare('SELECT 1 AS ready FROM workspace_settings WHERE id = 1').get())
  }

  loadSnapshot() {
    if (!this.hasSnapshot()) return null
    const metaRows = this.db.prepare('SELECT meta_key, value_json FROM application_meta').all()
    const metadata = new Map(metaRows.map((row) => [row.meta_key, jsonParse(row.value_json, null)]))
    const settings = this.db.prepare('SELECT settings_json FROM workspace_settings WHERE id = 1').get()
    const counters = Object.fromEntries(this.db.prepare('SELECT name, value FROM id_counters ORDER BY name').all().map((row) => [row.name, Number(row.value)]))
    const snapshot = {
      meta: metadata.get('store.meta') || {},
      configured: metadata.get('store.configured') === true,
      settings: jsonParse(settings?.settings_json, {}),
      counters
    }
    for (const collection of Object.keys(COLLECTIONS)) {
      const table = QUOTE(tableName(collection))
      snapshot[collection] = this.db.prepare(`SELECT * FROM ${table} ORDER BY ordinal, id`).all().map((row) => recordForRow(collection, row))
    }
    return snapshot
  }

  writeSnapshot(snapshot, { backup = false, backupReason = 'write' } = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('A workspace snapshot is required')
    if (backup) this.createBackup(backupReason)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.#releaseUniqueValues()
      for (const collection of TABLES_IN_WRITE_ORDER) this.#upsertCollection(collection, snapshot[collection] || [])
      for (const collection of TABLES_IN_DELETE_ORDER) this.#deleteMissing(collection, snapshot[collection] || [])
      this.#writeSingletons(snapshot)
      const brokenReferences = this.db.prepare('PRAGMA foreign_key_check').all()
      if (brokenReferences.length) throw new Error(`SQLite foreign-key validation failed: ${brokenReferences.length} invalid relationship(s)`)
      this.db.exec('COMMIT')
      return snapshot
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw error
    }
  }

  #releaseUniqueValues() {
    for (const [collection, definition] of Object.entries(COLLECTIONS)) {
      if (!definition.uniqueIndexes?.length) continue
      const uniqueColumns = [...new Set(definition.uniqueIndexes.map(([property]) => snakeCase(property)))]
      const assignments = [...uniqueColumns.map((column) => `${QUOTE(column)} = NULL`), "row_hash = '__pending__'"].join(', ')
      this.db.exec(`UPDATE ${QUOTE(tableName(collection))} SET ${assignments}`)
    }
  }

  #upsertCollection(collection, records) {
    if (!Array.isArray(records)) throw new TypeError(`${collection} must be an array`)
    const statement = this.#getInsertStatement(collection)
    const seen = new Set()
    records.forEach((record, ordinal) => {
      const row = rowForRecord(collection, record, ordinal)
      if (seen.has(row.id)) throw new Error(`Duplicate id in ${collection}: ${row.id}`)
      seen.add(row.id)
      const values = statement.columns.map((column) => row[column] ?? null)
      statement.statement.run(...values)
    })
  }

  #getInsertStatement(collection) {
    let cached = this.insertStatements.get(collection)
    if (cached) return cached
    const insert = insertSql(collection)
    cached = { columns: insert.columns, statement: this.db.prepare(insert.sql) }
    this.insertStatements.set(collection, cached)
    return cached
  }

  #deleteMissing(collection, records) {
    const table = QUOTE(tableName(collection))
    const currentIds = new Set(records.map((record) => String(record.id)))
    const existing = this.db.prepare(`SELECT id FROM ${table}`).all()
    const statement = this.#getDeleteStatement(collection)
    for (const { id } of existing) if (!currentIds.has(id)) statement.run(id)
  }

  #getDeleteStatement(collection) {
    let statement = this.deleteStatements.get(collection)
    if (!statement) {
      statement = this.db.prepare(`DELETE FROM ${QUOTE(tableName(collection))} WHERE id = ?`)
      this.deleteStatements.set(collection, statement)
    }
    return statement
  }

  #writeSingletons(snapshot) {
    const writeMeta = this.db.prepare('INSERT INTO application_meta(meta_key, value_json) VALUES(?, ?) ON CONFLICT(meta_key) DO UPDATE SET value_json=excluded.value_json')
    writeMeta.run('store.meta', json(snapshot.meta || {}))
    writeMeta.run('store.configured', JSON.stringify(snapshot.configured === true))
    const writeSettings = this.db.prepare('INSERT INTO workspace_settings(id, settings_json, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at')
    writeSettings.run(json(snapshot.settings || {}), String(snapshot.meta?.updatedAt || new Date().toISOString()))
    this.db.exec('DELETE FROM id_counters')
    const writeCounter = this.db.prepare('INSERT INTO id_counters(name, value) VALUES(?, ?)')
    for (const [name, value] of Object.entries(snapshot.counters || {})) {
      const number = Number(value)
      if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`Invalid counter ${name}`)
      writeCounter.run(name, number)
    }
  }

  createBackup(reason = 'manual') {
    fs.mkdirSync(path.join(this.dataDirectory, 'backups'), { recursive: true })
    const safeReason = String(reason).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32) || 'snapshot'
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(this.dataDirectory, 'backups', `atlas-db-${timestamp}-${safeReason}.sqlite`)
    const escapedPath = backupPath.replaceAll("'", "''")
    this.db.exec(`VACUUM INTO '${escapedPath}'`)
    try { fs.chmodSync(backupPath, 0o600) } catch {}
    this.pruneBackups()
    return backupPath
  }

  listBackups() {
    const backupDirectory = path.join(this.dataDirectory, 'backups')
    if (!fs.existsSync(backupDirectory)) return []
    return fs.readdirSync(backupDirectory)
      .filter((file) => file.endsWith('.sqlite') || file.endsWith('.json'))
      .map((file) => {
        const fullPath = path.join(backupDirectory, file)
        try { return { file, path: fullPath, createdAt: fs.statSync(fullPath).mtime.toISOString() } }
        catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  pruneBackups() {
    const currentBackups = this.listBackups().filter((backup) => backup.file.endsWith('.sqlite'))
    currentBackups.slice(this.backupRetention).forEach((backup) => { try { fs.unlinkSync(backup.path) } catch {} })
  }

  integrity() {
    const result = this.db.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0])
    const foreignKeys = this.db.prepare('PRAGMA foreign_key_check').all()
    return { ok: result.length === 1 && result[0] === 'ok' && foreignKeys.length === 0, result, foreignKeys }
  }

  tableCounts() {
    return Object.fromEntries(Object.entries(COLLECTIONS).map(([collection, definition]) => [collection, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${QUOTE(tableName(collection))}`).get().count)]))
  }

  databaseInfo() {
    return {
      engine: 'SQLite',
      version: this.db.prepare('SELECT sqlite_version() AS version').get().version,
      schemaVersion: Number(this.db.prepare('PRAGMA user_version').get().user_version),
      journalMode: this.db.prepare('PRAGMA journal_mode').get().journal_mode,
      fileName: this.filePath
    }
  }

  close() { this.db.close() }
}
