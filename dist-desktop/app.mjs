// app.tsx
import fs3 from "node:fs";
import path3 from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

// src/server/database/connection.js
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/server/database/schema.js
var field = (type, options = {}) => ({ type, ...options });
var COLLECTIONS = {
  teams: {
    fields: {
      name: field("TEXT"),
      color: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["name", "NOCASE"]],
    uniqueIndexes: [["name", "NOCASE"]]
  },
  people: {
    fields: {
      name: field("TEXT"),
      email: field("TEXT"),
      jobTitle: field("TEXT"),
      teamId: field("REFERENCE", { target: "teams", onDelete: "RESTRICT" }),
      focus: field("TEXT"),
      capacity: field("REAL"),
      status: field("TEXT"),
      color: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["teamId"], ["status"]],
    uniqueIndexes: [["email", "NOCASE"]],
    foreignKeys: [["teamId", "teams", "RESTRICT"]]
  },
  projects: {
    fields: {
      name: field("TEXT"),
      code: field("TEXT"),
      description: field("TEXT"),
      teamId: field("REFERENCE", { target: "teams", onDelete: "RESTRICT" }),
      ownerId: field("REFERENCE", { target: "people", onDelete: "RESTRICT" }),
      color: field("TEXT"),
      status: field("TEXT"),
      deadline: field("TEXT"),
      createdAt: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["teamId"], ["ownerId"], ["status"], ["deadline"]],
    uniqueIndexes: [["code", "NOCASE"]],
    foreignKeys: [["teamId", "teams", "RESTRICT"], ["ownerId", "people", "RESTRICT"]]
  },
  tasks: {
    fields: {
      title: field("TEXT"),
      projectId: field("REFERENCE", { target: "projects", onDelete: "CASCADE" }),
      assigneeId: field("REFERENCE", { target: "people", onDelete: "RESTRICT" }),
      priority: field("TEXT"),
      dueDate: field("TEXT"),
      status: field("TEXT"),
      type: field("TEXT"),
      blocked: field("BOOLEAN"),
      createdAt: field("TEXT"),
      completedAt: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["projectId"], ["assigneeId"], ["status"], ["priority"], ["dueDate"]],
    foreignKeys: [["projectId", "projects", "CASCADE"], ["assigneeId", "people", "RESTRICT"]]
  },
  milestones: {
    fields: {
      name: field("TEXT"),
      projectId: field("REFERENCE", { target: "projects", onDelete: "CASCADE" }),
      dueDate: field("TEXT"),
      status: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["projectId"], ["status"], ["dueDate"]],
    foreignKeys: [["projectId", "projects", "CASCADE"]]
  },
  activities: {
    fields: {
      personId: field("REFERENCE", { target: "people", onDelete: "RESTRICT" }),
      date: field("TEXT"),
      time: field("TEXT"),
      yesterday: field("TEXT"),
      today: field("TEXT"),
      blocked: field("TEXT"),
      upcoming: field("TEXT"),
      status: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["personId"], ["date"]],
    foreignKeys: [["personId", "people", "RESTRICT"]]
  },
  alerts: {
    fields: {
      title: field("TEXT"),
      body: field("TEXT"),
      type: field("TEXT"),
      tone: field("TEXT"),
      projectId: field("REFERENCE", { target: "projects", onDelete: "CASCADE" }),
      taskId: field("REFERENCE", { target: "tasks", onDelete: "CASCADE" }),
      personId: field("TEXT"),
      activityId: field("TEXT"),
      source: field("TEXT"),
      occurrences: field("INTEGER"),
      resolved: field("BOOLEAN"),
      createdAt: field("TEXT"),
      lastSeenAt: field("TEXT"),
      sample: field("BOOLEAN"),
      customFields: field("JSON")
    },
    indexes: [["projectId"], ["taskId"], ["personId"], ["resolved"], ["type"], ["createdAt"]],
    foreignKeys: [["projectId", "projects", "CASCADE"], ["taskId", "tasks", "CASCADE"]]
  },
  users: {
    fields: {
      name: field("TEXT"),
      email: field("TEXT"),
      passwordHash: field("TEXT"),
      role: field("TEXT"),
      personId: field("REFERENCE", { target: "people", onDelete: "RESTRICT" }),
      avatarColor: field("TEXT"),
      active: field("BOOLEAN"),
      createdAt: field("TEXT"),
      sample: field("BOOLEAN")
    },
    indexes: [["personId"], ["role"], ["active"]],
    uniqueIndexes: [["email", "NOCASE"]],
    foreignKeys: [["personId", "people", "RESTRICT"]]
  },
  workLogs: {
    table: "work_logs",
    fields: {
      personId: field("REFERENCE"),
      actorUserId: field("REFERENCE"),
      taskId: field("REFERENCE"),
      projectId: field("REFERENCE"),
      taskTitle: field("TEXT"),
      projectName: field("TEXT"),
      projectCode: field("TEXT"),
      action: field("TEXT"),
      statusFrom: field("TEXT"),
      statusTo: field("TEXT"),
      summary: field("TEXT"),
      date: field("TEXT"),
      time: field("TEXT"),
      minutes: field("REAL"),
      sample: field("BOOLEAN"),
      source: field("TEXT")
    },
    indexes: [["personId"], ["taskId"], ["projectId"], ["date"], ["action"]]
  },
  auditLogs: {
    table: "audit_logs",
    fields: { action: field("TEXT"), actorId: field("TEXT"), detail: field("JSON"), createdAt: field("TEXT"), source: field("TEXT") },
    indexes: [["action"], ["actorId"], ["createdAt"]]
  }
};
var quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
var sqlType = (definition) => definition.type === "BOOLEAN" ? "INTEGER" : definition.type === "REFERENCE" ? "TEXT" : definition.type === "JSON" ? "TEXT" : definition.type;
function createCollectionTable(tableName2, definition) {
  const columns = [
    "id TEXT NOT NULL PRIMARY KEY",
    "id_type TEXT NOT NULL CHECK(id_type IN ('string', 'number'))",
    "ordinal INTEGER NOT NULL CHECK(ordinal >= 0)"
  ];
  for (const [property, spec] of Object.entries(definition.fields)) {
    const column = quoteIdentifier(toSnakeCase(property));
    const type = sqlType(spec);
    const checks = [];
    if (spec.type === "BOOLEAN") checks.push(`${column} IS NULL OR ${column} IN (0, 1)`);
    if (spec.type === "JSON") checks.push(`${column} IS NULL OR json_valid(${column})`);
    columns.push(`${column} ${type}${checks.length ? ` CHECK(${checks.join(" AND ")})` : ""}`);
  }
  columns.push("attributes_json TEXT NOT NULL CHECK(json_valid(attributes_json))");
  columns.push("present_json TEXT NOT NULL CHECK(json_valid(present_json))");
  columns.push("field_states_json TEXT NOT NULL CHECK(json_valid(field_states_json))");
  columns.push("row_hash TEXT NOT NULL");
  for (const [property, target, onDelete] of definition.foreignKeys || []) {
    columns.push(`FOREIGN KEY(${quoteIdentifier(toSnakeCase(property))}) REFERENCES ${quoteIdentifier(target)}(id) ON DELETE ${onDelete} DEFERRABLE INITIALLY DEFERRED`);
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName2)} (${columns.join(", ")}) STRICT`;
}
function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
var CURRENT_SCHEMA_VERSION = 4;
function applyMigration(db, version, name, migrate) {
  db.exec("BEGIN IMMEDIATE");
  try {
    migrate();
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, datetime('now'))").run(version, name);
    db.exec(`PRAGMA user_version = ${version}`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
function createInitialSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS application_meta (
      meta_key TEXT NOT NULL PRIMARY KEY,
      value_json TEXT NOT NULL CHECK(json_valid(value_json))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_settings (
      id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
      settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS id_counters (
      name TEXT NOT NULL PRIMARY KEY,
      value INTEGER NOT NULL CHECK(value >= 1)
    ) STRICT;
  `);
  for (const [name, definition] of Object.entries(COLLECTIONS)) db.exec(createCollectionTable(definition.table || name, definition));
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_people_team ON people(team_id);
    CREATE INDEX IF NOT EXISTS idx_users_person ON users(person_id);
    CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
    CREATE INDEX IF NOT EXISTS idx_activities_person_date ON activities(person_id, date);
    CREATE INDEX IF NOT EXISTS idx_alerts_open_created ON alerts(resolved, created_at);
    CREATE INDEX IF NOT EXISTS idx_work_logs_person_date ON work_logs(person_id, date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL AND trim(email) <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_email_unique ON people(email COLLATE NOCASE) WHERE email IS NOT NULL AND trim(email) <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code_unique ON projects(code COLLATE NOCASE) WHERE code IS NOT NULL AND trim(code) <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name_unique ON teams(name COLLATE NOCASE) WHERE name IS NOT NULL AND trim(name) <> '';
  `);
}
function createUserPreferencesTable(db) {
  db.exec(`
    CREATE TABLE user_preferences (
      user_id TEXT NOT NULL PRIMARY KEY,
      filters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(filters_json)),
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE INDEX idx_user_preferences_updated ON user_preferences(updated_at);
  `);
}
function migrateDatabase(db) {
  let version = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
  if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than this application supports (${CURRENT_SCHEMA_VERSION})`);
  if (version < 1) {
    applyMigration(db, 1, "initial-relational-schema", () => createInitialSchema(db));
    version = 1;
  }
  if (version < 2) {
    applyMigration(db, 2, "user-saved-filters", () => createUserPreferencesTable(db));
    version = 2;
  }
  if (version < 3) {
    applyMigration(db, 3, "offline-sync-idempotency", () => {
      db.exec(`
        CREATE TABLE sync_operations (
          operation_id TEXT NOT NULL PRIMARY KEY,
          actor_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('applied', 'completed')),
          response_status INTEGER,
          response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
          created_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;
        CREATE INDEX idx_sync_operations_actor ON sync_operations(actor_id, created_at);
      `);
    });
    version = 3;
  }
  if (version < 4) {
    applyMigration(db, 4, "offline-sync-conflict-audit", () => {
      db.exec(`
        CREATE TABLE sync_conflicts (
          operation_id TEXT NOT NULL PRIMARY KEY,
          actor_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          entity_id TEXT,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          conflict_code TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'discarded')),
          base_json TEXT CHECK(base_json IS NULL OR json_valid(base_json)),
          local_json TEXT CHECK(local_json IS NULL OR json_valid(local_json)),
          server_json TEXT CHECK(server_json IS NULL OR json_valid(server_json)),
          fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields_json)),
          resolution_json TEXT CHECK(resolution_json IS NULL OR json_valid(resolution_json)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          resolved_at TEXT
        ) STRICT;
        CREATE INDEX idx_sync_conflicts_status_created ON sync_conflicts(status, created_at);
        CREATE INDEX idx_sync_conflicts_actor_created ON sync_conflicts(actor_id, created_at);
      `);
    });
  }
}

// src/server/database/connection.js
function ensurePrivateDataDirectory(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 448 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dataDirectory, 448);
    } catch {
    }
  }
}
function openSqliteDatabase(databasePath, { dataDirectory = path.dirname(databasePath) } = {}) {
  if (databasePath !== ":memory:") {
    ensurePrivateDataDirectory(dataDirectory);
    if (path.resolve(path.dirname(databasePath)) !== path.resolve(dataDirectory)) ensurePrivateDataDirectory(path.dirname(databasePath));
  }
  const existed = databasePath !== ":memory:" && fs.existsSync(databasePath);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec("PRAGMA trusted_schema = OFF");
    migrateDatabase(db);
    if (!existed && process.platform !== "win32") {
      try {
        fs.chmodSync(databasePath, 384);
      } catch {
      }
    }
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
    }
    throw error;
  }
}

// src/server/database/store-repository.js
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
var QUOTE = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
var snakeCase = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
var TABLES_IN_WRITE_ORDER = ["teams", "people", "projects", "tasks", "milestones", "activities", "alerts", "users", "workLogs", "auditLogs"];
var TABLES_IN_DELETE_ORDER = [...TABLES_IN_WRITE_ORDER].reverse();
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== void 0).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function json(value) {
  return JSON.stringify(canonicalize(value));
}
function jsonParse(value, fallback) {
  if (value === null || value === void 0) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function typeName(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  return typeof value;
}
function valueForSql(value, spec, fieldName) {
  if (value === void 0 || value === null) return null;
  if (spec.type === "JSON") return JSON.stringify(value);
  if (spec.type === "REFERENCE") {
    if (value === "") return null;
    if (typeof value !== "string" && typeof value !== "number") throw new TypeError(`${fieldName} must be a string, number, null, or empty value`);
    return String(value);
  }
  if (spec.type === "BOOLEAN") {
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new TypeError(`${fieldName} must be boolean`);
  }
  if (spec.type === "REAL" || spec.type === "INTEGER") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite numeric data`);
    if (spec.type === "INTEGER" && !Number.isInteger(number)) throw new TypeError(`${fieldName} must be an integer`);
    return number;
  }
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be text`);
  return value;
}
function rowForRecord(collection, record, ordinal) {
  const definition = COLLECTIONS[collection];
  if (!definition) throw new Error(`Unknown collection: ${collection}`);
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError(`${collection}[${ordinal}] must be an object`);
  if (typeof record.id !== "string" && typeof record.id !== "number") throw new TypeError(`${collection}[${ordinal}] requires a string or number id`);
  const fields = definition.fields;
  const knownFieldNames = new Set(Object.keys(fields));
  const attributes = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "id" && !knownFieldNames.has(key)));
  const row = {
    id: String(record.id),
    id_type: typeof record.id,
    ordinal,
    attributes_json: json(attributes),
    present_json: json(Object.keys(record).filter((key) => key === "id" || knownFieldNames.has(key))),
    field_states_json: "{}"
  };
  const fieldStates = {};
  for (const [property, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(record, property)) continue;
    const value = record[property];
    if (value === null || value === void 0) fieldStates[property] = typeName(value);
    else if (spec.type === "REFERENCE") fieldStates[property] = value === "" ? "empty" : typeof value;
    row[snakeCase(property)] = valueForSql(value, spec, `${collection}.${property}`);
  }
  row.field_states_json = json(fieldStates);
  const fingerprintSource = json({ record, ordinal });
  row.row_hash = digest(fingerprintSource);
  return row;
}
function recordForRow(collection, row) {
  const definition = COLLECTIONS[collection];
  const present = new Set(jsonParse(row.present_json, []));
  const states = jsonParse(row.field_states_json, {});
  const record = jsonParse(row.attributes_json, {});
  record.id = row.id_type === "number" ? Number(row.id) : row.id;
  for (const [property, spec] of Object.entries(definition.fields)) {
    if (!present.has(property)) continue;
    const state = states[property];
    if (state === "undefined") {
      record[property] = void 0;
      continue;
    }
    if (state === "null") {
      record[property] = null;
      continue;
    }
    if (state === "empty") {
      record[property] = "";
      continue;
    }
    const value = row[snakeCase(property)];
    if (spec.type === "JSON") record[property] = jsonParse(value, null);
    else if (spec.type === "BOOLEAN") record[property] = value === null ? null : Boolean(value);
    else if (spec.type === "REAL" || spec.type === "INTEGER") record[property] = value === null ? null : Number(value);
    else if (spec.type === "REFERENCE" && state === "number") record[property] = value === null ? null : Number(value);
    else record[property] = value;
  }
  return record;
}
function tableName(collection) {
  return COLLECTIONS[collection].table || collection;
}
function insertSql(collection) {
  const definition = COLLECTIONS[collection];
  const table = QUOTE(tableName(collection));
  const fields = Object.keys(definition.fields).map(snakeCase);
  const columns = ["id", "id_type", "ordinal", ...fields, "attributes_json", "present_json", "field_states_json", "row_hash"];
  const placeholders = columns.map(() => "?").join(", ");
  const assignments = columns.slice(1).map((column) => `${QUOTE(column)} = excluded.${QUOTE(column)}`).join(", ");
  return { columns, sql: `INSERT INTO ${table} (${columns.map(QUOTE).join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${assignments} WHERE ${table}.row_hash <> excluded.row_hash` };
}
var SqliteStoreRepository = class {
  constructor(db, { filePath, dataDirectory, backupRetention = 25 } = {}) {
    this.db = db;
    this.filePath = filePath;
    this.dataDirectory = dataDirectory || path2.dirname(filePath);
    this.backupRetention = backupRetention;
    this.insertStatements = /* @__PURE__ */ new Map();
    this.deleteStatements = /* @__PURE__ */ new Map();
  }
  hasSnapshot() {
    return Boolean(this.db.prepare("SELECT 1 AS ready FROM workspace_settings WHERE id = 1").get());
  }
  loadSnapshot() {
    if (!this.hasSnapshot()) return null;
    const metaRows = this.db.prepare("SELECT meta_key, value_json FROM application_meta").all();
    const metadata = new Map(metaRows.map((row) => [row.meta_key, jsonParse(row.value_json, null)]));
    const settings = this.db.prepare("SELECT settings_json FROM workspace_settings WHERE id = 1").get();
    const counters = Object.fromEntries(this.db.prepare("SELECT name, value FROM id_counters ORDER BY name").all().map((row) => [row.name, Number(row.value)]));
    const snapshot = {
      meta: metadata.get("store.meta") || {},
      configured: metadata.get("store.configured") === true,
      settings: jsonParse(settings?.settings_json, {}),
      counters
    };
    for (const collection of Object.keys(COLLECTIONS)) {
      const table = QUOTE(tableName(collection));
      snapshot[collection] = this.db.prepare(`SELECT * FROM ${table} ORDER BY ordinal, id`).all().map((row) => recordForRow(collection, row));
    }
    return snapshot;
  }
  writeSnapshot(snapshot, { backup = false, backupReason = "write", syncOperation = null } = {}) {
    if (!snapshot || typeof snapshot !== "object") throw new TypeError("A workspace snapshot is required");
    if (backup) this.createBackup(backupReason);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.#releaseUniqueValues();
      for (const collection of TABLES_IN_WRITE_ORDER) this.#upsertCollection(collection, snapshot[collection] || []);
      for (const collection of TABLES_IN_DELETE_ORDER) this.#deleteMissing(collection, snapshot[collection] || []);
      this.#writeSingletons(snapshot);
      if (syncOperation?.operationId && syncOperation?.actorId && syncOperation?.requestHash) {
        this.db.prepare(`
          INSERT INTO sync_operations(operation_id, actor_id, request_hash, status, response_status, response_json, created_at, completed_at)
          VALUES(?, ?, ?, 'applied', NULL, NULL, ?, NULL)
          ON CONFLICT(operation_id) DO NOTHING
        `).run(syncOperation.operationId, syncOperation.actorId, syncOperation.requestHash, (/* @__PURE__ */ new Date()).toISOString());
      }
      const brokenReferences = this.db.prepare("PRAGMA foreign_key_check").all();
      if (brokenReferences.length) throw new Error(`SQLite foreign-key validation failed: ${brokenReferences.length} invalid relationship(s)`);
      this.db.exec("COMMIT");
      return snapshot;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw error;
    }
  }
  #releaseUniqueValues() {
    for (const [collection, definition] of Object.entries(COLLECTIONS)) {
      if (!definition.uniqueIndexes?.length) continue;
      const uniqueColumns = [...new Set(definition.uniqueIndexes.map(([property]) => snakeCase(property)))];
      const assignments = [...uniqueColumns.map((column) => `${QUOTE(column)} = NULL`), "row_hash = '__pending__'"].join(", ");
      this.db.exec(`UPDATE ${QUOTE(tableName(collection))} SET ${assignments}`);
    }
  }
  #upsertCollection(collection, records) {
    if (!Array.isArray(records)) throw new TypeError(`${collection} must be an array`);
    const statement = this.#getInsertStatement(collection);
    const seen = /* @__PURE__ */ new Set();
    records.forEach((record, ordinal) => {
      const row = rowForRecord(collection, record, ordinal);
      if (seen.has(row.id)) throw new Error(`Duplicate id in ${collection}: ${row.id}`);
      seen.add(row.id);
      const values = statement.columns.map((column) => row[column] ?? null);
      statement.statement.run(...values);
    });
  }
  #getInsertStatement(collection) {
    let cached = this.insertStatements.get(collection);
    if (cached) return cached;
    const insert = insertSql(collection);
    cached = { columns: insert.columns, statement: this.db.prepare(insert.sql) };
    this.insertStatements.set(collection, cached);
    return cached;
  }
  #deleteMissing(collection, records) {
    const table = QUOTE(tableName(collection));
    const currentIds = new Set(records.map((record) => String(record.id)));
    const existing = this.db.prepare(`SELECT id FROM ${table}`).all();
    const statement = this.#getDeleteStatement(collection);
    for (const { id: id2 } of existing) if (!currentIds.has(id2)) statement.run(id2);
  }
  #getDeleteStatement(collection) {
    let statement = this.deleteStatements.get(collection);
    if (!statement) {
      statement = this.db.prepare(`DELETE FROM ${QUOTE(tableName(collection))} WHERE id = ?`);
      this.deleteStatements.set(collection, statement);
    }
    return statement;
  }
  #writeSingletons(snapshot) {
    const writeMeta = this.db.prepare("INSERT INTO application_meta(meta_key, value_json) VALUES(?, ?) ON CONFLICT(meta_key) DO UPDATE SET value_json=excluded.value_json");
    writeMeta.run("store.meta", json(snapshot.meta || {}));
    writeMeta.run("store.configured", JSON.stringify(snapshot.configured === true));
    const writeSettings = this.db.prepare("INSERT INTO workspace_settings(id, settings_json, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at");
    writeSettings.run(json(snapshot.settings || {}), String(snapshot.meta?.updatedAt || (/* @__PURE__ */ new Date()).toISOString()));
    this.db.exec("DELETE FROM id_counters");
    const writeCounter = this.db.prepare("INSERT INTO id_counters(name, value) VALUES(?, ?)");
    for (const [name, value] of Object.entries(snapshot.counters || {})) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`Invalid counter ${name}`);
      writeCounter.run(name, number);
    }
  }
  getSyncOperation(operationId) {
    const row = this.db.prepare("SELECT operation_id, actor_id, request_hash, status, response_status, response_json, created_at, completed_at FROM sync_operations WHERE operation_id = ?").get(String(operationId));
    if (!row) return null;
    let responseBody = null;
    if (row.response_json !== null) {
      try {
        responseBody = JSON.parse(row.response_json);
      } catch {
      }
    }
    return {
      operationId: row.operation_id,
      actorId: row.actor_id,
      requestHash: row.request_hash,
      status: row.status,
      responseStatus: row.response_status === null ? null : Number(row.response_status),
      responseBody,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  }
  getSyncConflict(operationId) {
    const row = this.db.prepare("SELECT * FROM sync_conflicts WHERE operation_id = ?").get(String(operationId));
    if (!row) return null;
    return {
      operationId: row.operation_id,
      actorId: row.actor_id,
      collection: row.collection,
      entityId: row.entity_id,
      method: row.method,
      path: row.path,
      code: row.conflict_code,
      status: row.status,
      baseRecord: jsonParse(row.base_json, null),
      localRecord: jsonParse(row.local_json, null),
      serverRecord: jsonParse(row.server_json, null),
      fields: jsonParse(row.fields_json, []),
      resolution: jsonParse(row.resolution_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at
    };
  }
  recordSyncConflict(conflict) {
    if (!conflict?.operationId || !conflict?.actorId || !conflict?.collection || !conflict?.code) throw new TypeError("A complete offline-sync conflict is required");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const asJson = (value) => value === void 0 || value === null ? null : json(value);
    this.db.prepare(`
      INSERT INTO sync_conflicts(operation_id, actor_id, collection, entity_id, method, path, conflict_code, status, base_json, local_json, server_json, fields_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO NOTHING
    `).run(
      String(conflict.operationId),
      String(conflict.actorId),
      String(conflict.collection),
      conflict.entityId == null ? null : String(conflict.entityId),
      String(conflict.method || "POST"),
      String(conflict.path || ""),
      String(conflict.code),
      asJson(conflict.baseRecord),
      asJson(conflict.localRecord),
      asJson(conflict.serverRecord),
      json(conflict.fields || []),
      now,
      now
    );
    return this.getSyncConflict(conflict.operationId);
  }
  resolveSyncConflict(operationId, actorId, resolution) {
    const action = String(resolution?.action || "");
    const status = action === "keep-server" || action === "discard" ? "discarded" : "resolved";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = this.getSyncConflict(operationId);
    if (!existing || existing.actorId !== String(actorId)) return null;
    if (existing.status === "open") {
      this.db.prepare(`
        UPDATE sync_conflicts SET status = ?, resolution_json = ?, updated_at = ?, resolved_at = ?
        WHERE operation_id = ? AND actor_id = ? AND status = 'open'
      `).run(status, json(resolution || {}), now, now, String(operationId), String(actorId));
    }
    return this.getSyncConflict(operationId);
  }
  pruneSyncConflicts(retentionDays = 365) {
    const requestedDays = Number(retentionDays);
    const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(3650, Math.floor(requestedDays))) : 365;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    return this.db.prepare("DELETE FROM sync_conflicts WHERE status <> 'open' AND resolved_at IS NOT NULL AND resolved_at < ?").run(cutoff).changes;
  }
  listSyncConflicts({ limit = 500, status = "" } = {}) {
    const count = Math.max(1, Math.min(5e3, Number(limit) || 500));
    const rows = status ? this.db.prepare("SELECT operation_id FROM sync_conflicts WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(String(status), count) : this.db.prepare("SELECT operation_id FROM sync_conflicts ORDER BY created_at DESC LIMIT ?").all(count);
    return rows.map((row) => this.getSyncConflict(row.operation_id)).filter(Boolean);
  }
  completeSyncOperation(operation, responseStatus, responseBody) {
    if (!operation?.operationId || !operation?.actorId || !operation?.requestHash) throw new TypeError("A complete offline-sync operation receipt is required");
    const responseJson = JSON.stringify(responseBody ?? null);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(`
      INSERT INTO sync_operations(operation_id, actor_id, request_hash, status, response_status, response_json, created_at, completed_at)
      VALUES(?, ?, ?, 'completed', ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        status = 'completed', response_status = excluded.response_status,
        response_json = excluded.response_json, completed_at = excluded.completed_at
      WHERE sync_operations.actor_id = excluded.actor_id AND sync_operations.request_hash = excluded.request_hash
    `).run(operation.operationId, operation.actorId, operation.requestHash, Number(responseStatus), responseJson, now, now);
    return this.getSyncOperation(operation.operationId);
  }
  createBackup(reason = "manual") {
    fs2.mkdirSync(path2.join(this.dataDirectory, "backups"), { recursive: true });
    const safeReason = String(reason).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 32) || "snapshot";
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const backupPath = path2.join(this.dataDirectory, "backups", `atlas-db-${timestamp}-${safeReason}.sqlite`);
    const escapedPath = backupPath.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escapedPath}'`);
    try {
      fs2.chmodSync(backupPath, 384);
    } catch {
    }
    this.pruneBackups();
    return backupPath;
  }
  listBackups() {
    const backupDirectory = path2.join(this.dataDirectory, "backups");
    if (!fs2.existsSync(backupDirectory)) return [];
    return fs2.readdirSync(backupDirectory).filter((file) => file.endsWith(".sqlite") || file.endsWith(".json")).map((file) => {
      const fullPath = path2.join(backupDirectory, file);
      try {
        return { file, path: fullPath, createdAt: fs2.statSync(fullPath).mtime.toISOString() };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  pruneBackups() {
    const currentBackups = this.listBackups().filter((backup) => backup.file.endsWith(".sqlite"));
    currentBackups.slice(this.backupRetention).forEach((backup) => {
      try {
        fs2.unlinkSync(backup.path);
      } catch {
      }
    });
  }
  integrity() {
    const result = this.db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
    const foreignKeys = this.db.prepare("PRAGMA foreign_key_check").all();
    return { ok: result.length === 1 && result[0] === "ok" && foreignKeys.length === 0, result, foreignKeys };
  }
  tableCounts() {
    const counts = Object.fromEntries(Object.entries(COLLECTIONS).map(([collection, definition]) => [collection, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${QUOTE(tableName(collection))}`).get().count)]));
    counts.userPreferences = Number(this.db.prepare("SELECT COUNT(*) AS count FROM user_preferences").get().count);
    counts.syncOperations = Number(this.db.prepare("SELECT COUNT(*) AS count FROM sync_operations").get().count);
    return counts;
  }
  databaseInfo() {
    return {
      engine: "SQLite",
      version: this.db.prepare("SELECT sqlite_version() AS version").get().version,
      schemaVersion: Number(this.db.prepare("PRAGMA user_version").get().user_version),
      journalMode: this.db.prepare("PRAGMA journal_mode").get().journal_mode,
      fileName: this.filePath
    };
  }
  close() {
    this.db.close();
  }
};

// src/server/database/user-preferences-repository.js
function parseFilters(value) {
  if (value === null || value === void 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
var UserPreferencesRepository = class {
  constructor(db) {
    this.getStatement = db.prepare("SELECT filters_json FROM user_preferences WHERE user_id = ?");
    this.saveStatement = db.prepare(`
      INSERT INTO user_preferences(user_id, filters_json, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET filters_json = excluded.filters_json, updated_at = excluded.updated_at
    `);
  }
  getFilters(userId) {
    const row = this.getStatement.get(String(userId));
    return parseFilters(row?.filters_json);
  }
  saveFilters(userId, filters) {
    this.saveStatement.run(String(userId), JSON.stringify(filters), (/* @__PURE__ */ new Date()).toISOString());
    return this.getFilters(userId);
  }
};

// src/server/routes/system.routes.js
function registerSystemRoutes(app2, services) {
  const { store: store2, getStore, setStore, root: root2, databaseFile: databaseFile2, DATABASE_MODEL: DATABASE_MODEL2, STORE_SCHEMA_VERSION: STORE_SCHEMA_VERSION2, DESIGN_SYSTEM_VERSION: DESIGN_SYSTEM_VERSION2, configuredBackupRetention: configuredBackupRetention2, allowDemoData: allowDemoData2, rateLimitMiddleware: rateLimitMiddleware2, setupRateLimits: setupRateLimits2, loginRateLimits: loginRateLimits2, i18nRateLimits: i18nRateLimits2, sendError: sendError2, normalizeEmail: normalizeEmail2, isValidEmail: isValidEmail2, validatePassword: validatePassword2, configuredPasswordMinLength: configuredPasswordMinLength2, settingsInputError: settingsInputError2, mergeDeep: mergeDeep2, defaultSettings: defaultSettings2, normalizeSettings: normalizeSettings2, hashPassword: hashPassword2, todayLA: todayLA2, timeLA: timeLA2, publicUser: publicUser2, newSession: newSession2, sessionCookieOptions: sessionCookieOptions2, auditLog: auditLog2, persist: persist2, pruneWorkLedger: pruneWorkLedger2, can: can2, storeRepository: storeRepository2, listBackups: listBackups2, auditRead: auditRead2, storeChecksum: storeChecksum2, validateStoreState: validateStoreState2, requireUser: requireUser2, requireAdmin: requireAdmin2, requirePermission: requirePermission2, createBackup: createBackup2, roleRank: roleRank2, publicAccessUser: publicAccessUser2, verifyPassword: verifyPassword2, invalidateUserSessions: invalidateUserSessions2, sessions: sessions2, normalizeUserSecrets: normalizeUserSecrets2, projectById: projectById2, validText: validText2, MAX_PASSWORD_LENGTH: MAX_PASSWORD_LENGTH2, activityReportFor: activityReportFor2, reportFor: reportFor2, bootstrapFor: bootstrapFor2, settingsForUser: settingsForUser2, demoStore: demoStore2, id: id2, MAX_I18N_KEY_LENGTH: MAX_I18N_KEY_LENGTH2, I18N_MISSING_LIMIT: I18N_MISSING_LIMIT2, isPlainObject: isPlainObject2, path: path4 } = services;
  app2.get("/api/health", (req, res) => res.json({ ok: true, name: "Atlas Workspace", version: "1.0.0", mode: process.env.NODE_ENV || "development", desktopReady: process.env.ATLAS_DESKTOP === "true", time: (/* @__PURE__ */ new Date()).toISOString() }));
  app2.get("/api/runtime-config", requireUser2, requireAdmin2, (req, res) => {
    const databaseInfo = storeRepository2.databaseInfo();
    res.json({
      packagingMode: process.env.ATLAS_DESKTOP === "true" ? "electron-desktop" : process.env.NODE_ENV === "production" ? "production-web" : "development-web",
      designSystem: { version: DESIGN_SYSTEM_VERSION2, localFonts: true, externalUiAssets: false },
      database: { engine: databaseInfo.engine, engineVersion: databaseInfo.version, fileName: path4.relative(root2, databaseFile2), storeModel: DATABASE_MODEL2, schemaVersion: databaseInfo.schemaVersion, dataSchemaVersion: STORE_SCHEMA_VERSION2, journalMode: databaseInfo.journalMode, transactionalWrites: true, backupRetention: configuredBackupRetention2() },
      packaging: { web: true, pwa: true, localAssets: true }
    });
  });
  app2.get("/api/setup/status", (req, res) => res.json({
    configured: Boolean(store2.configured || store2.users.length),
    demoAllowed: allowDemoData2,
    demo: allowDemoData2 ? {
      email: "maya@atlas.local",
      password: "atlas-demo",
      accounts: [
        { email: "maya@atlas.local", password: "atlas-demo", role: "Administrator", name: "Maya Chen" },
        { email: "manager@atlas.local", password: "manager-demo", role: "Manager", name: "Noah Reed" },
        { email: "developer@atlas.local", password: "developer-demo", role: "Developer", name: "Lina Patel" },
        { email: "viewer@atlas.local", password: "viewer-demo", role: "Viewer", name: "Omar Haddad" }
      ]
    } : null
  }));
  app2.post("/api/setup", rateLimitMiddleware2(setupRateLimits2, 5, 60 * 60 * 1e3), (req, res) => {
    if (store2.configured || store2.users.length > 0) return sendError2(res, 409, "Workspace setup has already been completed");
    const { name, email, password, includeDemo = false, workspaceName, workspaceUnit, settings = {} } = req.body;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = normalizeEmail2(email);
    if (!cleanName || cleanName.length > 120 || !isValidEmail2(cleanEmail) || !validatePassword2(password)) return sendError2(res, 400, `Name, valid email, and a password of at least ${configuredPasswordMinLength2()} characters are required`);
    if (settingsInputError2(settings)) return sendError2(res, 400, settingsInputError2(settings));
    const cleanWorkspaceName = typeof workspaceName === "string" && workspaceName.trim() ? workspaceName.trim() : settings.workspace?.name || "Atlas Workspace";
    const cleanWorkspaceUnit = typeof workspaceUnit === "string" && workspaceUnit.trim() ? workspaceUnit.trim() : settings.workspace?.unit || "Operations";
    if (cleanWorkspaceName.length > 120 || cleanWorkspaceUnit.length > 120) return sendError2(res, 400, "Workspace name and unit must be 120 characters or fewer");
    const previousStore = getStore();
    const hasExistingRecords = ["users", "teams", "people", "projects", "tasks", "milestones", "activities", "alerts", "workLogs", "auditLogs"].some((key) => Array.isArray(previousStore?.[key]) && previousStore[key].length > 0);
    if (includeDemo === true && allowDemoData2 && hasExistingRecords) return sendError2(res, 409, "Demo data can only be added to an empty workspace; existing workspace records have been preserved");
    const nextStore = includeDemo === true && allowDemoData2 ? demoStore2() : structuredClone(previousStore);
    if (nextStore.users.some((user2) => normalizeEmail2(user2.email) === cleanEmail)) return sendError2(res, 409, "A user with this email already exists in the selected sample data");
    const existingPerson = nextStore.people.find((person) => normalizeEmail2(person.email) === cleanEmail);
    let personId = existingPerson?.id;
    if (!personId) {
      const existingTeam = nextStore.teams.find((team) => String(team.name || "").trim().toLowerCase() === cleanWorkspaceUnit.toLowerCase());
      const teamId = existingTeam?.id || id2("team");
      if (!existingTeam) nextStore.teams.push({ id: teamId, name: cleanWorkspaceUnit, color: "purple", sample: false });
      personId = id2("person");
      nextStore.people.push({ id: personId, name: cleanName, email: cleanEmail, jobTitle: "Workspace Administrator", teamId, focus: "Workspace setup", capacity: 75, status: "On track", color: "purple", sample: false });
    }
    const user = { id: id2("user"), name: cleanName, email: cleanEmail, passwordHash: hashPassword2(password), role: "Administrator", personId, avatarColor: "purple", active: true, createdAt: (/* @__PURE__ */ new Date()).toISOString(), sample: false };
    nextStore.users.push(user);
    nextStore.settings = normalizeSettings2(mergeDeep2(nextStore.settings, settings));
    nextStore.settings.workspace.name = cleanWorkspaceName;
    nextStore.settings.workspace.unit = cleanWorkspaceUnit;
    nextStore.settings.workspaceName = cleanWorkspaceName;
    nextStore.settings.workspaceUnit = cleanWorkspaceUnit;
    nextStore.configured = true;
    setStore(nextStore);
    auditLog2("workspace.setup.completed", user.id, { workspaceName: cleanWorkspaceName, workspaceUnit: cleanWorkspaceUnit });
    try {
      persist2({ reason: "setup" });
    } catch (error) {
      setStore(previousStore);
      throw error;
    }
    const sid = newSession2(user.id);
    res.cookie("atlas_sid", sid, sessionCookieOptions2());
    res.json({ setup: { configured: true }, user: publicUser2(user), sessionExpiresAt: sessions2.get(sid)?.expiresAt || Date.now() });
  });
  app2.post("/api/auth/login", rateLimitMiddleware2(loginRateLimits2, 20, 15 * 60 * 1e3), (req, res) => {
    const { email, password } = req.body;
    const normalized = normalizeEmail2(email);
    const user = store2.users.find((candidate) => normalizeEmail2(candidate.email) === normalized);
    if (!user || typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH2 || !verifyPassword2(password, user)) return sendError2(res, 401, "Invalid email or password");
    if (user.active === false) return sendError2(res, 403, "This account is disabled. Contact an administrator.");
    if (user.password && !user.passwordHash) normalizeUserSecrets2(user);
    user.lastLoginAt = (/* @__PURE__ */ new Date()).toISOString();
    auditLog2("auth.login", user.id, { email: user.email });
    persist2({ reason: "login" });
    const sid = newSession2(user.id);
    res.cookie("atlas_sid", sid, sessionCookieOptions2());
    res.json({ user: publicUser2(user), sessionExpiresAt: sessions2.get(sid)?.expiresAt || Date.now() });
  });
  app2.post("/api/auth/logout", (req, res) => {
    const sessionId = req.cookies.atlas_sid;
    if (sessionId) sessions2.delete(sessionId);
    res.clearCookie("atlas_sid", sessionCookieOptions2());
    res.json({ ok: true });
  });
  app2.get("/api/auth/me", requireUser2, (req, res) => res.json({ user: publicUser2(req.user), sessionExpiresAt: sessions2.get(req.cookies?.atlas_sid)?.expiresAt || Date.now() }));
  app2.get("/api/bootstrap", requireUser2, (req, res) => {
    auditRead2("bootstrap", req.user.id);
    res.json(bootstrapFor2(req.user));
  });
  app2.get("/api/reports/:period", requireUser2, requirePermission2("viewReports"), (req, res) => {
    auditRead2("report", req.user.id);
    res.json(reportFor2(req.params.period));
  });
  app2.get("/api/reports/activity/:period", requireUser2, requirePermission2("viewReports"), (req, res) => {
    auditRead2("activity-report", req.user.id);
    const isAdministrator = req.user.role === "Administrator";
    const scope = isAdministrator ? req.query.userId || "all" : String(req.user.personId || `unlinked:${req.user.id}`);
    res.json(activityReportFor2(req.params.period, scope));
  });
  app2.post("/api/audit/export", requireUser2, requirePermission2("exportData"), (req, res) => {
    const { title, format, rowCount } = req.body;
    if (!validText2(title, 200) || !["csv", "xlsx", "json", "pdf", "print"].includes(format) || !Number.isSafeInteger(rowCount) || rowCount < 0) return sendError2(res, 400, "A title, supported export format, and valid row count are required");
    auditLog2("export.data", req.user.id, { title: title.trim(), format, rowCount });
    persist2({ reason: "export-audit" });
    res.json({ ok: true });
  });
  app2.get("/api/offline-sync/conflicts", requireUser2, requireAdmin2, (req, res) => {
    storeRepository2.pruneSyncConflicts(store2?.settings?.audit?.retentionDays);
    auditRead2("offline-sync-conflicts", req.user.id);
    res.json(storeRepository2.listSyncConflicts({ limit: Number(req.query.limit) || 500, status: req.query.status || "" }));
  });
  app2.get("/api/system", requireUser2, requireAdmin2, (req, res) => {
    auditRead2("system", req.user.id);
    const validation = validateStoreState2(store2);
    const databaseIntegrity = storeRepository2.integrity();
    const backups = listBackups2();
    if (!databaseIntegrity.ok) validation.errors.push("SQLite integrity check failed");
    validation.integrity = validation.errors.length ? "attention" : validation.warnings.length ? "warning" : "ok";
    res.json({ ok: validation.integrity === "ok", integrity: validation.integrity, errors: validation.errors, warnings: validation.warnings, databaseIntegrity, checksum: storeChecksum2(store2), store: { fileName: path4.relative(root2, databaseFile2), storeModel: DATABASE_MODEL2, schemaVersion: STORE_SCHEMA_VERSION2, databaseSchemaVersion: storeRepository2.databaseInfo().schemaVersion, meta: store2.meta, backups: backups.slice(0, 5).map((backup) => ({ file: backup.file, createdAt: backup.createdAt })), backupCount: backups.length, sampleRows: [...store2.people, ...store2.projects, ...store2.tasks, ...store2.activities, ...store2.alerts, ...store2.workLogs || []].filter((row) => row.sample).length, livePeople: store2.people.filter((p) => !p.sample).length }, counts: storeRepository2.tableCounts() });
  });
  app2.get("/api/settings/export", requireUser2, requireAdmin2, (req, res) => {
    if (store2.settings.storage.importExportEnabled === false) return sendError2(res, 403, "Configuration export is disabled by workspace policy");
    auditRead2("settings-export", req.user.id);
    auditLog2("export.settings", req.user.id, { format: "json" });
    persist2({ reason: "settings-export" });
    res.json({ exportedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: STORE_SCHEMA_VERSION2, settings: store2.settings });
  });
  app2.post("/api/settings/import", requireUser2, requireAdmin2, (req, res) => {
    if (store2.settings.storage.importExportEnabled === false) return sendError2(res, 403, "Configuration import is disabled by workspace policy");
    const imported = req.body.settings || req.body;
    const error = settingsInputError2(imported);
    if (error) return sendError2(res, 400, error);
    const existingWorkLedgerRetention = store2.settings.workLedger?.retentionMonths ?? 0;
    store2.settings = normalizeSettings2(imported);
    if (!isPlainObject2(imported.workLedger) || !Object.hasOwn(imported.workLedger, "retentionMonths")) store2.settings.workLedger.retentionMonths = existingWorkLedgerRetention;
    pruneWorkLedger2(store2);
    auditLog2("settings.imported", req.user.id, { keys: Object.keys(imported) });
    persist2({ reason: "settings-import" });
    res.json(store2.settings);
  });
  function translationCatalogPayload(language = null) {
    const localization = store2.settings.localization || {};
    const fallback = localization.fallbackLanguage || "en";
    const selected = language || localization.defaultLanguage || store2.settings.language || fallback || "en";
    const fallbackCatalog = localization.translations?.[fallback] || {};
    const selectedCatalog = localization.translations?.[selected] || {};
    return {
      language: selected,
      fallbackLanguage: fallback,
      direction: localization.textDirectionByLanguage?.[selected] || (["ar", "fa", "he", "ur"].includes(selected) ? "rtl" : "ltr"),
      catalog: { ...fallbackCatalog, ...selectedCatalog },
      fallbackCatalog,
      languages: localization.languagePackages || [],
      activeLanguages: localization.activeLanguages || [],
      interfaces: localization.interfaces || {},
      keyPolicy: localization.keyPolicy || {},
      runtime: localization.runtime || {},
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  app2.get("/api/settings/translations/missing", requireUser2, requireAdmin2, (req, res) => {
    auditRead2("missing-translations", req.user.id);
    const localization = store2.settings.localization || {};
    const fallback = localization.fallbackLanguage || "en";
    const baseKeys = Object.keys(localization.translations?.[fallback] || {});
    const missing = Object.fromEntries((localization.activeLanguages || []).map((lang) => [lang, baseKeys.filter((key) => !localization.translations?.[lang]?.[key])]));
    const totalMissing = Object.values(missing).reduce((sum, rows) => sum + rows.length, 0);
    res.json({ fallback, keys: baseKeys, missing, totalMissing, byLanguage: missing });
  });
  app2.get("/api/i18n/catalog", requireUser2, requireAdmin2, (req, res) => res.json(translationCatalogPayload(req.query.language || req.query.lang || null)));
  app2.post("/api/i18n/missing", rateLimitMiddleware2(i18nRateLimits2, 30, 10 * 60 * 1e3), (req, res) => {
    if (!store2.configured) return res.json({ ok: true, ignored: true });
    const localization = store2.settings.localization || {};
    if (localization.runtime?.reportMissing === false) return res.json({ ok: true, ignored: true });
    const key = typeof req.body.key === "string" ? req.body.key.trim() : "";
    if (!key) return res.json({ ok: true, ignored: true });
    if (key.length > MAX_I18N_KEY_LENGTH2) return sendError2(res, 400, `Translation keys may not exceed ${MAX_I18N_KEY_LENGTH2} characters`);
    const language = typeof req.body.language === "string" ? req.body.language.trim() : String(localization.defaultLanguage || "en");
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) return sendError2(res, 400, "Invalid language code");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = { key, language, fallback: String(req.body.fallback || "").slice(0, 500), source: String(req.body.source || "runtime").slice(0, 100), firstSeenAt: now, lastSeenAt: now, count: 1, status: "missing" };
    localization.missingKeys = Array.isArray(localization.missingKeys) ? localization.missingKeys.slice(-I18N_MISSING_LIMIT2) : [];
    const existing = localization.missingKeys.find((item) => item.key === key && item.language === language);
    if (existing) {
      existing.lastSeenAt = now;
      existing.count = Math.min(I18N_MISSING_LIMIT2, Number(existing.count || 0) + 1);
      if (row.fallback) existing.fallback = row.fallback;
    } else {
      if (localization.missingKeys.length >= I18N_MISSING_LIMIT2) localization.missingKeys.shift();
      localization.missingKeys.push(row);
    }
    store2.settings.localization = localization;
    persist2({ reason: "i18n-missing" });
    res.json({ ok: true });
  });
  app2.post("/api/i18n/register", requireUser2, requireAdmin2, (req, res) => {
    const namespace = String(req.body?.namespace || "").trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
    if (!namespace) return sendError2(res, 400, "Translation namespace is required");
    const translations = req.body?.translations || {};
    const metadata = req.body?.metadata || {};
    const localization = store2.settings.localization || {};
    localization.translations = localization.translations || {};
    localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ["en"];
    Object.entries(translations).forEach(([language, catalog]) => {
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return;
      localization.translations[language] = { ...localization.translations[language] || {}, ...catalog };
      if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language);
    });
    localization.interfaces = mergeDeep2(localization.interfaces || {}, { [namespace]: { namespace, label: metadata.label || namespace, version: metadata.version || "1.0.0", owner: metadata.owner || "custom", status: metadata.status || "active", route: metadata.route || "", registeredAt: (/* @__PURE__ */ new Date()).toISOString(), keys: Object.keys(translations?.[localization.fallbackLanguage || "en"] || translations?.en || {}) } });
    localization.translationMemory = Array.isArray(localization.translationMemory) ? localization.translationMemory : [];
    localization.translationMemory.push({ namespace, action: "registered", languages: Object.keys(translations), userId: req.user.id, at: (/* @__PURE__ */ new Date()).toISOString() });
    store2.settings.localization = localization;
    store2.settings = normalizeSettings2(store2.settings);
    auditLog2("i18n.interface.registered", req.user.id, { namespace, languages: Object.keys(translations) });
    persist2({ reason: "i18n-register" });
    res.json({ ok: true, namespace, catalog: translationCatalogPayload() });
  });
  app2.put("/api/i18n/translation", requireUser2, requireAdmin2, (req, res) => {
    const language = String(req.body?.language || "").trim();
    const key = String(req.body?.key || "").trim();
    const value = String(req.body?.value ?? "");
    const status = String(req.body?.status || "approved");
    if (!language || !key) return sendError2(res, 400, "Language and key are required");
    const localization = store2.settings.localization || {};
    localization.translations = localization.translations || {};
    localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ["en"];
    if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language);
    localization.translations[language] = { ...localization.translations[language] || {}, [key]: value };
    localization.approvalWorkflow = localization.approvalWorkflow || { enabled: true, statusByKey: {} };
    localization.approvalWorkflow.statusByKey = { ...localization.approvalWorkflow.statusByKey || {}, [key]: status };
    localization.missingKeys = (localization.missingKeys || []).filter((row) => !(row.key === key && row.language === language));
    store2.settings.localization = localization;
    store2.settings = normalizeSettings2(store2.settings);
    auditLog2("i18n.translation.updated", req.user.id, { language, key, status });
    persist2({ reason: "i18n-translation" });
    res.json({ ok: true, language, key, value, status });
  });
  app2.post("/api/i18n/bulk", requireUser2, requireAdmin2, (req, res) => {
    const resources = req.body?.translations || req.body?.resources || {};
    if (!resources || typeof resources !== "object" || Array.isArray(resources)) return sendError2(res, 400, "Translation resources are required");
    const localization = store2.settings.localization || {};
    localization.translations = localization.translations || {};
    localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ["en"];
    Object.entries(resources).forEach(([language, catalog]) => {
      if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
        localization.translations[language] = { ...localization.translations[language] || {}, ...catalog };
        if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language);
      }
    });
    localization.translationMemory = Array.isArray(localization.translationMemory) ? localization.translationMemory : [];
    localization.translationMemory.push({ action: "bulk-import", languages: Object.keys(resources), userId: req.user.id, at: (/* @__PURE__ */ new Date()).toISOString() });
    store2.settings.localization = localization;
    store2.settings = normalizeSettings2(store2.settings);
    auditLog2("i18n.bulk.imported", req.user.id, { languages: Object.keys(resources) });
    persist2({ reason: "i18n-bulk" });
    res.json({ ok: true, catalog: translationCatalogPayload() });
  });
  app2.post("/api/system/backup", requireUser2, requireAdmin2, (req, res) => {
    const backup = createBackup2("admin");
    auditLog2("system.backup.created", req.user.id, { backup: backup && path4.basename(backup) });
    persist2({ reason: "backup-audit" });
    res.json({ ok: Boolean(backup), backup: backup && path4.basename(backup) });
  });
  app2.put("/api/settings", requireUser2, requireAdmin2, (req, res) => {
    const error = settingsInputError2(req.body);
    if (error) return sendError2(res, 400, error);
    store2.settings = normalizeSettings2(mergeDeep2(store2.settings, req.body));
    pruneWorkLedger2(store2);
    auditLog2("settings.updated", req.user.id, { branches: Object.keys(req.body) });
    persist2({ reason: "settings" });
    res.json(store2.settings);
  });
  app2.delete("/api/setup/seed", requireUser2, requireAdmin2, (req, res) => {
    const retainedTaskIds = new Set(store2.tasks.filter((task) => !task.sample).map((task) => String(task.id)));
    const retainedProjectIds = new Set([
      ...store2.tasks.filter((task) => !task.sample).map((task) => String(task.projectId)),
      ...store2.milestones.filter((row) => !row.sample).map((row) => String(row.projectId)),
      ...store2.alerts.filter((row) => !row.sample).map((row) => String(row.projectId || ""))
    ].filter(Boolean));
    store2.tasks = store2.tasks.filter((task) => !task.sample);
    store2.projects = store2.projects.filter((project) => !project.sample || retainedProjectIds.has(String(project.id)));
    store2.projects.forEach((project) => {
      if (project.sample && retainedProjectIds.has(String(project.id))) project.sample = false;
    });
    store2.milestones = store2.milestones.filter((row) => !row.sample && projectById2(row.projectId));
    store2.activities = store2.activities.filter((row) => !row.sample);
    store2.alerts = store2.alerts.filter((row) => !row.sample && (!row.taskId || retainedTaskIds.has(String(row.taskId))) && (!row.projectId || projectById2(row.projectId)));
    store2.workLogs = (store2.workLogs || []).filter((log) => !log.sample && (!log.taskId || retainedTaskIds.has(String(log.taskId))));
    const referencedPeople = new Set([
      ...store2.users.map((user) => String(user.personId || "")),
      ...store2.tasks.map((task) => String(task.assigneeId || "")),
      ...store2.projects.map((project) => String(project.ownerId || "")),
      ...store2.activities.map((activity) => String(activity.personId || "")),
      ...store2.workLogs.map((log) => String(log.personId || ""))
    ].filter(Boolean));
    store2.people = store2.people.filter((person) => !person.sample || referencedPeople.has(String(person.id)));
    store2.people.forEach((person) => {
      if (person.sample && referencedPeople.has(String(person.id))) person.sample = false;
    });
    const referencedTeams = new Set([
      ...store2.people.map((person) => String(person.teamId || "")),
      ...store2.projects.map((project) => String(project.teamId || ""))
    ].filter(Boolean));
    store2.teams = store2.teams.filter((team) => !team.sample || referencedTeams.has(String(team.id)));
    store2.teams.forEach((team) => {
      if (team.sample && referencedTeams.has(String(team.id))) team.sample = false;
    });
    auditLog2("demo-data.removed", req.user.id, {});
    persist2({ reason: "remove-demo" });
    res.json({ ok: true });
  });
}

// src/server/routes/tasks-projects.routes.js
function registerTaskProjectRoutes(app2, services) {
  const { store: store2, sendError: sendError2, requireUser: requireUser2, requirePermission: requirePermission2, validText: validText2, validOptionalDate: validOptionalDate2, validEmail: validEmail2, teamReferenceExists: teamReferenceExists2, personReferenceExists: personReferenceExists2, customFieldInputError: customFieldInputError2, todayLA: todayLA2, nextProjectId: nextProjectId2, nextTaskId: nextTaskId2, id: id2, taskPublic: taskPublic2, projectPublic: projectPublic2, projectById: projectById2, taskById: taskById2, taskWorkflowStates: taskWorkflowStates2, terminalTaskStates: terminalTaskStates2, isDone: isDone2, logWorkEvent: logWorkEvent2, auditLog: auditLog2, persist: persist2, can: can2, taskReferenceExists: taskReferenceExists2, validDateValue: validDateValue2, personById: personById2, dueTone: dueTone2, createDatabaseExportContext: createDatabaseExportContext2, auditRead: auditRead2, offlineCreateId: offlineCreateId2 } = services;
  app2.get("/api/projects/:id/tasks", requireUser2, (req, res) => {
    const context = createDatabaseExportContext2();
    const project = context.snapshot.projects.find((row) => String(row.id) === String(req.params.id));
    if (!project) return sendError2(res, 404, "Project not found");
    const indexes = {
      people: new Map(context.snapshot.people.map((person) => [String(person.id), person])),
      projects: new Map(context.snapshot.projects.map((row) => [String(row.id), row])),
      teams: new Map(context.snapshot.teams.map((team) => [String(team.id), team]))
    };
    const projectTasks = context.snapshot.tasks.filter((task) => String(task.projectId) === String(project.id));
    const tasks = projectTasks.map((task) => context.workspace.taskPublic(task, context.today, indexes)).sort((left, right) => String(left.dueDate || "").localeCompare(String(right.dueDate || "")) || left.title.localeCompare(right.title));
    const milestones = context.snapshot.milestones.filter((milestone) => String(milestone.projectId) === String(project.id)).map((milestone) => ({ ...milestone, project: project.name }));
    auditRead2("project-tasks", req.user.id);
    res.json({ source: "sqlite", project: context.workspace.projectPublic(project, context.today, projectTasks, indexes), tasks, milestones, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app2.post("/api/tasks", requireUser2, requirePermission2("manageTasks"), (req, res) => {
    const body = req.body;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const project = projectById2(body.projectId ?? store2.projects[0]?.id);
    const assigneeId = body.assigneeId === void 0 ? String(req.user.personId || "") : String(body.assigneeId || "");
    const status = body.status ?? taskWorkflowStates2()[0] ?? "To do";
    const priority = body.priority ?? "Medium";
    const dueDate = body.dueDate ?? todayLA2();
    if (!validText2(title, 200)) return sendError2(res, 400, "Task title is required and must be 200 characters or fewer");
    if (!project) return sendError2(res, 400, "A valid project is required");
    if (!personReferenceExists2(assigneeId)) return sendError2(res, 400, "The selected task owner does not exist");
    if (!taskWorkflowStates2().includes(status)) return sendError2(res, 400, "Invalid task workflow state");
    if (!["High", "Medium", "Low"].includes(priority)) return sendError2(res, 400, "Invalid task priority");
    if (!validOptionalDate2(dueDate)) return sendError2(res, 400, "Task due date must be a valid calendar date");
    if (body.type !== void 0 && !validText2(body.type, 80)) return sendError2(res, 400, "Task type must be between 1 and 80 characters");
    if (body.blocked !== void 0 && typeof body.blocked !== "boolean") return sendError2(res, 400, "Blocked must be a boolean");
    if (body.tags !== void 0 && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((tag) => !validText2(tag, 60)))) return sendError2(res, 400, "Tags must contain up to 50 values of 60 characters or fewer");
    const tags = body.tags === void 0 ? [] : [...new Map(body.tags.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()];
    const customFieldError = customFieldInputError2("tasks", body.customFields || {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const task = {
      id: offlineCreateId2(req, "tasks", nextTaskId2),
      title,
      projectId: project.id,
      assigneeId,
      priority,
      dueDate,
      status,
      type: body.type || "Development",
      blocked: body.blocked === true,
      tags,
      customFields: body.customFields || {},
      createdAt: todayLA2(),
      sample: false
    };
    if (isDone2(task)) task.completedAt = todayLA2();
    store2.tasks.push(task);
    logWorkEvent2({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: isDone2(task) ? "Created and completed task" : "Created task", statusTo: task.status, summary: task.title, minutes: 0 });
    auditLog2("task.created", req.user.id, { taskId: task.id, projectId: task.projectId });
    persist2({ reason: "task-create" });
    res.json(taskPublic2(task, todayLA2()));
  });
  app2.put("/api/tasks/:id", requireUser2, requirePermission2("manageTasks"), (req, res) => {
    const task = taskById2(req.params.id);
    if (!task) return sendError2(res, 404, "Task not found");
    const body = req.body;
    const project = projectById2(body.projectId ?? task.projectId);
    const assigneeId = body.assigneeId === void 0 ? task.assigneeId : String(body.assigneeId || "");
    const status = body.status ?? task.status;
    const priority = body.priority ?? task.priority;
    const dueDate = body.dueDate ?? task.dueDate;
    const title = body.title === void 0 ? task.title : typeof body.title === "string" ? body.title.trim() : "";
    if (!validText2(title, 200)) return sendError2(res, 400, "Task title is required and must be 200 characters or fewer");
    if (!project) return sendError2(res, 400, "A valid project is required");
    if (!personReferenceExists2(assigneeId)) return sendError2(res, 400, "The selected task owner does not exist");
    if (!taskWorkflowStates2().includes(status)) return sendError2(res, 400, "Invalid task workflow state");
    if (!["High", "Medium", "Low"].includes(priority)) return sendError2(res, 400, "Invalid task priority");
    if (!validOptionalDate2(dueDate)) return sendError2(res, 400, "Task due date must be a valid calendar date");
    if (body.type !== void 0 && !validText2(body.type, 80)) return sendError2(res, 400, "Task type must be between 1 and 80 characters");
    if (body.blocked !== void 0 && typeof body.blocked !== "boolean") return sendError2(res, 400, "Blocked must be a boolean");
    if (body.tags !== void 0 && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((tag) => !validText2(tag, 60)))) return sendError2(res, 400, "Tags must contain up to 50 values of 60 characters or fewer");
    const tags = body.tags === void 0 ? task.tags || [] : [...new Map(body.tags.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()];
    const customFieldError = customFieldInputError2("tasks", body.customFields ?? task.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const previous = { status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, tags: task.tags || [], customFields: task.customFields };
    const wasDone = isDone2(task);
    Object.assign(task, {
      title,
      projectId: project.id,
      assigneeId,
      priority,
      dueDate,
      status,
      type: body.type ?? task.type,
      blocked: body.blocked ?? task.blocked,
      tags,
      customFields: body.customFields ?? task.customFields ?? {}
    });
    const isNowDone = isDone2(task);
    task.completedAt = isNowDone ? wasDone ? task.completedAt || todayLA2() : todayLA2() : void 0;
    if (JSON.stringify(previous) !== JSON.stringify({ status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, tags: task.tags || [], customFields: task.customFields })) {
      logWorkEvent2({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: "Updated task", statusFrom: previous.status, statusTo: task.status, summary: task.title, minutes: 0 });
      auditLog2("task.updated", req.user.id, { taskId: task.id, previousStatus: previous.status, status: task.status });
      persist2({ reason: "task-update" });
    }
    res.json(taskPublic2(task, todayLA2()));
  });
  app2.patch("/api/tasks/:id/status", requireUser2, requirePermission2("writeTasks"), (req, res) => {
    const task = taskById2(req.params.id);
    if (!task) return sendError2(res, 404, "Task not found");
    if (!can2(req.user, "manageTasks") && String(task.assigneeId || "") !== String(req.user.personId || "")) return sendError2(res, 403, "You may only update the workflow state of tasks assigned to your profile");
    const statuses = taskWorkflowStates2();
    const previousStatus = task.status;
    let nextStatus = previousStatus;
    if (Object.hasOwn(req.body, "status")) {
      if (typeof req.body.status !== "string" || !statuses.includes(req.body.status)) return sendError2(res, 400, "Invalid task workflow state");
      nextStatus = req.body.status;
    } else if (req.body.advance === true) {
      const currentIndex = statuses.indexOf(previousStatus);
      if (currentIndex < 0) return sendError2(res, 409, "The task has a workflow state that is no longer configured");
      nextStatus = statuses[Math.min(statuses.length - 1, currentIndex + 1)];
    } else return sendError2(res, 400, "A valid status or advance flag is required");
    if (nextStatus === previousStatus) return res.json(taskPublic2(task, todayLA2()));
    task.status = nextStatus;
    const terminal = terminalTaskStates2().includes(task.status) || task.status === "Done";
    task.completedAt = terminal ? previousStatus && (terminalTaskStates2().includes(previousStatus) || previousStatus === "Done") ? task.completedAt || todayLA2() : todayLA2() : void 0;
    logWorkEvent2({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: terminal ? "Completed task" : "Moved task", statusFrom: previousStatus, statusTo: task.status, summary: task.title, minutes: 0 });
    auditLog2("task.status.changed", req.user.id, { taskId: task.id, from: previousStatus, to: task.status });
    persist2({ reason: "task-status" });
    res.json(taskPublic2(task, todayLA2()));
  });
  app2.post("/api/tasks/bulk", requireUser2, (req, res) => {
    const body = req.body || {};
    const action = body.action;
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
    if (!ids.length || ids.length > 1e3 || ids.some((value) => !value || value.length > 200)) return sendError2(res, 400, "Select between 1 and 1000 task records per bulk request");
    if (!["edit", "delete"].includes(action)) return sendError2(res, 400, "Unsupported task bulk operation");
    if (action === "delete") {
      if (!can2(req.user, "manageTasks")) return sendError2(res, 403, "Task management access is required for bulk deletion");
      const selected = new Set(ids);
      const existing = store2.tasks.filter((task) => selected.has(String(task.id)));
      const found = new Set(existing.map((task) => String(task.id)));
      const failures2 = ids.filter((taskId) => !found.has(taskId)).map((id3) => ({ id: id3, error: "Task not found" }));
      if (existing.length) {
        store2.tasks = store2.tasks.filter((task) => !selected.has(String(task.id)));
        store2.alerts = store2.alerts.filter((alert) => !selected.has(String(alert.taskId || "")));
        auditLog2("tasks.bulk.deleted", req.user.id, { requested: ids.length, affected: existing.length, taskIds: existing.map((task) => task.id) });
        persist2({ reason: "tasks-bulk-delete" });
      }
      return res.json({ requested: ids.length, affected: existing.length, succeeded: existing.map((task) => task.id), failures: failures2 });
    }
    const changes = body.changes;
    const allowedFields = /* @__PURE__ */ new Set(["title", "projectId", "assigneeId", "priority", "dueDate", "status", "type", "blocked", "tags"]);
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some((key) => !allowedFields.has(key))) return sendError2(res, 400, "Bulk task edits contain unsupported fields");
    const statusOnly = Object.keys(changes).every((key) => key === "status");
    if (statusOnly ? !can2(req.user, "writeTasks") : !can2(req.user, "manageTasks")) return sendError2(res, 403, statusOnly ? "Task workflow access is required" : "Task management access is required for these bulk fields");
    const failures = [];
    const succeeded = [];
    const changedFields = Object.keys(changes);
    const tasksById = new Map(store2.tasks.map((task) => [String(task.id), task]));
    for (const taskId of ids) {
      const task = tasksById.get(taskId);
      if (!task) {
        failures.push({ id: taskId, error: "Task not found" });
        continue;
      }
      if (!can2(req.user, "manageTasks") && String(task.assigneeId || "") !== String(req.user.personId || "")) {
        failures.push({ id: taskId, error: "You may only update tasks assigned to your profile" });
        continue;
      }
      const next = { ...task };
      const candidate = changes;
      if (Object.hasOwn(candidate, "title")) next.title = typeof candidate.title === "string" ? candidate.title.trim() : "";
      if (Object.hasOwn(candidate, "projectId")) {
        const project = projectById2(candidate.projectId);
        if (!project) {
          failures.push({ id: taskId, error: "A valid project is required" });
          continue;
        }
        next.projectId = project.id;
      }
      if (Object.hasOwn(candidate, "assigneeId")) {
        const assigneeId = String(candidate.assigneeId || "");
        if (!personReferenceExists2(assigneeId)) {
          failures.push({ id: taskId, error: "The selected task owner does not exist" });
          continue;
        }
        next.assigneeId = assigneeId;
      }
      if (Object.hasOwn(candidate, "priority")) next.priority = candidate.priority;
      if (Object.hasOwn(candidate, "dueDate")) next.dueDate = candidate.dueDate;
      if (Object.hasOwn(candidate, "status")) next.status = candidate.status;
      if (Object.hasOwn(candidate, "type")) next.type = candidate.type;
      if (Object.hasOwn(candidate, "blocked")) next.blocked = candidate.blocked;
      if (Object.hasOwn(candidate, "tags")) {
        if (!Array.isArray(candidate.tags) || candidate.tags.length > 50 || candidate.tags.some((tag) => !validText2(tag, 60))) {
          failures.push({ id: taskId, error: "Tags must contain up to 50 values of 60 characters or fewer" });
          continue;
        }
        next.tags = [...new Map(candidate.tags.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()];
      }
      if (!validText2(next.title, 200)) {
        failures.push({ id: taskId, error: "Task title is required and must be 200 characters or fewer" });
        continue;
      }
      if (!taskWorkflowStates2().includes(next.status)) {
        failures.push({ id: taskId, error: "Invalid task workflow state" });
        continue;
      }
      if (!["High", "Medium", "Low"].includes(next.priority)) {
        failures.push({ id: taskId, error: "Invalid task priority" });
        continue;
      }
      if (!validOptionalDate2(next.dueDate)) {
        failures.push({ id: taskId, error: "Task due date must be a valid calendar date" });
        continue;
      }
      if (candidate.type !== void 0 && !validText2(next.type, 80)) {
        failures.push({ id: taskId, error: "Task type must be between 1 and 80 characters" });
        continue;
      }
      if (candidate.blocked !== void 0 && typeof next.blocked !== "boolean") {
        failures.push({ id: taskId, error: "Blocked must be a boolean" });
        continue;
      }
      const changed = changedFields.some((field3) => JSON.stringify(task[field3]) !== JSON.stringify(next[field3]));
      if (!changed) {
        succeeded.push(task.id);
        continue;
      }
      const wasDone = isDone2(task);
      const previousStatus = task.status;
      Object.assign(task, next);
      const isNowDone = isDone2(task);
      task.completedAt = isNowDone ? wasDone ? task.completedAt || todayLA2() : todayLA2() : void 0;
      logWorkEvent2({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: "Bulk updated task", statusFrom: previousStatus === task.status ? void 0 : previousStatus, statusTo: previousStatus === task.status ? void 0 : task.status, summary: task.title, minutes: 0 });
      succeeded.push(task.id);
    }
    if (succeeded.length) {
      auditLog2("tasks.bulk.updated", req.user.id, { requested: ids.length, affected: succeeded.length, fields: changedFields });
      persist2({ reason: "tasks-bulk-update" });
    }
    res.json({ requested: ids.length, affected: succeeded.length, succeeded, failures });
  });
  app2.delete("/api/tasks/:id", requireUser2, requirePermission2("manageTasks"), (req, res) => {
    const task = taskById2(req.params.id);
    if (!task) return sendError2(res, 404, "Task not found");
    store2.tasks = store2.tasks.filter((row) => String(row.id) !== String(task.id));
    store2.alerts = store2.alerts.filter((alert) => String(alert.taskId || "") !== String(task.id));
    auditLog2("task.deleted", req.user.id, { taskId: task.id, title: task.title, projectId: task.projectId });
    persist2({ reason: "task-delete" });
    res.json({ ok: true });
  });
  app2.post("/api/projects", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const body = req.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const teamId = body.teamId ?? store2.teams[0]?.id ?? "";
    const ownerId = body.ownerId ?? req.user.personId ?? "";
    const status = body.status ?? "On track";
    const deadline = body.deadline ?? todayLA2();
    if (!validText2(name, 160)) return sendError2(res, 400, "Project name is required and must be 160 characters or fewer");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) return sendError2(res, 400, "Project code must be 1\u201320 letters, numbers, hyphens, or underscores");
    if (store2.projects.some((project2) => String(project2.code).toUpperCase() === code)) return sendError2(res, 409, "Project code already exists");
    if (!teamReferenceExists2(teamId) || !personReferenceExists2(ownerId)) return sendError2(res, 400, "Project team or owner does not exist");
    if (!["On track", "At risk", "Completed"].includes(status)) return sendError2(res, 400, "Invalid project status");
    if (!validOptionalDate2(deadline)) return sendError2(res, 400, "Project deadline must be a valid calendar date");
    if (body.description !== void 0 && (typeof body.description !== "string" || body.description.length > 3e3)) return sendError2(res, 400, "Project description must be 3000 characters or fewer");
    const customFieldError = customFieldInputError2("projects", body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const project = { id: offlineCreateId2(req, "projects", nextProjectId2), name, code, description: body.description || "", teamId, ownerId, color: body.color || "purple", status, deadline, createdAt: todayLA2(), customFields: body.customFields || {}, sample: false };
    store2.projects.push(project);
    auditLog2("project.created", req.user.id, { projectId: project.id });
    persist2({ reason: "project-create" });
    res.json(projectPublic2(project, todayLA2()));
  });
  app2.put("/api/projects/:id", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const project = projectById2(req.params.id);
    if (!project) return sendError2(res, 404, "Project not found");
    const body = req.body;
    const name = body.name === void 0 ? project.name : typeof body.name === "string" ? body.name.trim() : "";
    const code = body.code === void 0 ? project.code : typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const teamId = body.teamId ?? project.teamId;
    const ownerId = body.ownerId ?? project.ownerId;
    const status = body.status ?? project.status;
    const deadline = body.deadline ?? project.deadline;
    if (!validText2(name, 160)) return sendError2(res, 400, "Project name is required and must be 160 characters or fewer");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) return sendError2(res, 400, "Project code must be 1\u201320 letters, numbers, hyphens, or underscores");
    if (store2.projects.some((row) => row.id !== project.id && String(row.code).toUpperCase() === code)) return sendError2(res, 409, "Project code already exists");
    if (!teamReferenceExists2(teamId) || !personReferenceExists2(ownerId)) return sendError2(res, 400, "Project team or owner does not exist");
    if (!["On track", "At risk", "Completed"].includes(status)) return sendError2(res, 400, "Invalid project status");
    if (!validOptionalDate2(deadline)) return sendError2(res, 400, "Project deadline must be a valid calendar date");
    if (body.description !== void 0 && (typeof body.description !== "string" || body.description.length > 3e3)) return sendError2(res, 400, "Project description must be 3000 characters or fewer");
    const customFieldError = customFieldInputError2("projects", body.customFields ?? project.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    Object.assign(project, { name, code, teamId, ownerId, status, deadline, description: body.description ?? project.description, color: body.color ?? project.color, customFields: body.customFields ?? project.customFields ?? {} });
    auditLog2("project.updated", req.user.id, { projectId: project.id });
    persist2({ reason: "project-update" });
    res.json(projectPublic2(project, todayLA2()));
  });
  app2.delete("/api/projects/:id", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const project = projectById2(req.params.id);
    if (!project) return sendError2(res, 404, "Project not found");
    const removedTaskIds = new Set(store2.tasks.filter((task) => String(task.projectId) === String(project.id)).map((task) => String(task.id)));
    store2.projects = store2.projects.filter((row) => String(row.id) !== String(project.id));
    store2.tasks = store2.tasks.filter((task) => String(task.projectId) !== String(project.id));
    store2.milestones = store2.milestones.filter((row) => String(row.projectId) !== String(project.id));
    store2.alerts = store2.alerts.filter((alert) => String(alert.projectId || "") !== String(project.id) && !removedTaskIds.has(String(alert.taskId || "")));
    auditLog2("project.deleted", req.user.id, { projectId: project.id, name: project.name, removedTasks: removedTaskIds.size });
    persist2({ reason: "project-delete" });
    res.json({ ok: true });
  });
}

// src/server/routes/directory.routes.js
function registerDirectoryRoutes(app2, services) {
  const { store: store2, sendError: sendError2, requireUser: requireUser2, requirePermission: requirePermission2, validText: validText2, validEmail: validEmail2, teamReferenceExists: teamReferenceExists2, personReferenceExists: personReferenceExists2, projectReferenceExists: projectReferenceExists2, taskReferenceExists: taskReferenceExists2, customFieldInputError: customFieldInputError2, teamById: teamById2, todayLA: todayLA2, validOptionalDate: validOptionalDate2, id: id2, personById: personById2, projectById: projectById2, taskById: taskById2, personPublic: personPublic2, auditLog: auditLog2, persist: persist2, offlineCreateId: offlineCreateId2 } = services;
  app2.post("/api/people", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const body = req.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const teamId = body.teamId ?? store2.teams[0]?.id ?? "";
    const capacity = body.capacity === void 0 ? 70 : Number(body.capacity);
    const status = body.status ?? "On track";
    if (!validText2(name, 120) || !validEmail2(email)) return sendError2(res, 400, "A name (up to 120 characters) and valid email address are required");
    if (store2.people.some((person2) => String(person2.email || "").toLowerCase() === email)) return sendError2(res, 409, "A person with this email already exists");
    if (!teamReferenceExists2(teamId)) return sendError2(res, 400, "Selected team does not exist");
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) return sendError2(res, 400, "Capacity must be between 0 and 100");
    if (!["On track", "Needs attention"].includes(status)) return sendError2(res, 400, "Invalid person status");
    const customFieldError = customFieldInputError2("people", body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const person = { id: offlineCreateId2(req, "people", () => id2("person")), name, email, jobTitle: typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 120) : "Contributor", teamId, focus: typeof body.focus === "string" ? body.focus.trim().slice(0, 300) : "", capacity, status, color: typeof body.color === "string" ? body.color.slice(0, 40) : "purple", customFields: body.customFields || {}, sample: false };
    store2.people.push(person);
    auditLog2("person.created", req.user.id, { personId: person.id });
    persist2({ reason: "person-create" });
    res.json(personPublic2(person));
  });
  app2.put("/api/people/:id", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const person = personById2(req.params.id);
    if (!person) return sendError2(res, 404, "Person not found");
    const body = req.body;
    const name = body.name === void 0 ? person.name : typeof body.name === "string" ? body.name.trim() : "";
    const email = body.email === void 0 ? person.email : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const teamId = body.teamId ?? person.teamId;
    const capacity = body.capacity === void 0 ? person.capacity : Number(body.capacity);
    const status = body.status ?? person.status;
    if (!validText2(name, 120) || !validEmail2(email)) return sendError2(res, 400, "A name (up to 120 characters) and valid email address are required");
    if (store2.people.some((row) => row.id !== person.id && String(row.email || "").toLowerCase() === email)) return sendError2(res, 409, "A person with this email already exists");
    if (!teamReferenceExists2(teamId)) return sendError2(res, 400, "Selected team does not exist");
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) return sendError2(res, 400, "Capacity must be between 0 and 100");
    if (!["On track", "Needs attention"].includes(status)) return sendError2(res, 400, "Invalid person status");
    const customFieldError = customFieldInputError2("people", body.customFields ?? person.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    Object.assign(person, { name, email, teamId, capacity, status, jobTitle: body.jobTitle === void 0 ? person.jobTitle : String(body.jobTitle).trim().slice(0, 120), focus: body.focus === void 0 ? person.focus : String(body.focus).trim().slice(0, 300), color: body.color ?? person.color, customFields: body.customFields ?? person.customFields ?? {} });
    auditLog2("person.updated", req.user.id, { personId: person.id });
    persist2({ reason: "person-update" });
    res.json(personPublic2(person));
  });
  app2.delete("/api/people/:id", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const person = personById2(req.params.id);
    if (!person) return sendError2(res, 404, "Person not found");
    if (store2.users.some((user) => String(user.personId || "") === String(person.id))) return sendError2(res, 400, "This person is linked to a user account and cannot be deleted");
    if (store2.tasks.some((task) => String(task.assigneeId || "") === String(person.id)) || store2.projects.some((project) => String(project.ownerId || "") === String(person.id)) || store2.activities.some((activity) => String(activity.personId || "") === String(person.id)) || (store2.workLogs || []).some((log) => String(log.personId || "") === String(person.id))) return sendError2(res, 409, "Reassign this person\u2019s work and activity history before deleting the profile");
    store2.people = store2.people.filter((row) => String(row.id) !== String(person.id));
    auditLog2("person.deleted", req.user.id, { personId: person.id, name: person.name });
    persist2({ reason: "person-delete" });
    res.json({ ok: true });
  });
  app2.post("/api/teams", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!validText2(name, 120)) return sendError2(res, 400, "Team name is required and must be 120 characters or fewer");
    if (store2.teams.some((team2) => team2.name.toLowerCase() === name.toLowerCase())) return sendError2(res, 409, "A team with this name already exists");
    const customFieldError = customFieldInputError2("teams", req.body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const team = { id: offlineCreateId2(req, "teams", () => id2("team")), name, color: typeof req.body.color === "string" ? req.body.color.slice(0, 40) : "purple", customFields: req.body.customFields || {}, sample: false };
    store2.teams.push(team);
    auditLog2("team.created", req.user.id, { teamId: team.id });
    persist2({ reason: "team-create" });
    res.json(team);
  });
  app2.put("/api/teams/:id", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const team = teamById2(req.params.id);
    if (!team) return sendError2(res, 404, "Team not found");
    const name = req.body.name === void 0 ? team.name : typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!validText2(name, 120)) return sendError2(res, 400, "Team name is required and must be 120 characters or fewer");
    if (store2.teams.some((row) => row.id !== team.id && row.name.toLowerCase() === name.toLowerCase())) return sendError2(res, 409, "A team with this name already exists");
    const customFieldError = customFieldInputError2("teams", req.body.customFields ?? team.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    Object.assign(team, { name, color: req.body.color ?? team.color, customFields: req.body.customFields ?? team.customFields ?? {} });
    auditLog2("team.updated", req.user.id, { teamId: team.id });
    persist2({ reason: "team-update" });
    res.json(team);
  });
  app2.delete("/api/teams/:id", requireUser2, requirePermission2("managePeople"), (req, res) => {
    const team = teamById2(req.params.id);
    if (!team) return sendError2(res, 404, "Team not found");
    if (store2.people.some((person) => person.teamId === team.id) || store2.projects.some((project) => project.teamId === team.id)) return sendError2(res, 400, "Move people and projects before deleting this team");
    store2.teams = store2.teams.filter((row) => row.id !== team.id);
    auditLog2("team.deleted", req.user.id, { teamId: team.id });
    persist2({ reason: "team-delete" });
    res.json({ ok: true });
  });
  app2.post("/api/milestones", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const project = projectById2(req.body.projectId ?? store2.projects[0]?.id);
    const dueDate = req.body.dueDate ?? todayLA2();
    const status = req.body.status ?? "Upcoming";
    if (!validText2(name, 160)) return sendError2(res, 400, "Milestone name is required and must be 160 characters or fewer");
    if (!project) return sendError2(res, 400, "A valid project is required");
    if (!validOptionalDate2(dueDate)) return sendError2(res, 400, "Milestone due date must be a valid calendar date");
    if (!["Upcoming", "At risk", "Complete"].includes(status)) return sendError2(res, 400, "Invalid milestone status");
    const customFieldError = customFieldInputError2("milestones", req.body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const milestone = { id: offlineCreateId2(req, "milestones", () => id2("milestone")), name, projectId: project.id, dueDate, status, customFields: req.body.customFields || {}, sample: false };
    store2.milestones.push(milestone);
    auditLog2("milestone.created", req.user.id, { milestoneId: milestone.id });
    persist2({ reason: "milestone-create" });
    res.json(milestone);
  });
  app2.put("/api/milestones/:id", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const milestone = store2.milestones.find((row) => String(row.id) === String(req.params.id));
    if (!milestone) return sendError2(res, 404, "Milestone not found");
    const name = req.body.name === void 0 ? milestone.name : typeof req.body.name === "string" ? req.body.name.trim() : "";
    const project = projectById2(req.body.projectId ?? milestone.projectId);
    const dueDate = req.body.dueDate ?? milestone.dueDate;
    const status = req.body.status ?? milestone.status;
    if (!validText2(name, 160)) return sendError2(res, 400, "Milestone name is required and must be 160 characters or fewer");
    if (!project) return sendError2(res, 400, "A valid project is required");
    if (!validOptionalDate2(dueDate)) return sendError2(res, 400, "Milestone due date must be a valid calendar date");
    if (!["Upcoming", "At risk", "Complete"].includes(status)) return sendError2(res, 400, "Invalid milestone status");
    const customFieldError = customFieldInputError2("milestones", req.body.customFields ?? milestone.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    Object.assign(milestone, { name, projectId: project.id, dueDate, status, customFields: req.body.customFields ?? milestone.customFields ?? {} });
    auditLog2("milestone.updated", req.user.id, { milestoneId: milestone.id });
    persist2({ reason: "milestone-update" });
    res.json(milestone);
  });
  app2.delete("/api/milestones/:id", requireUser2, requirePermission2("manageProjects"), (req, res) => {
    const milestone = store2.milestones.find((row) => String(row.id) === String(req.params.id));
    if (!milestone) return sendError2(res, 404, "Milestone not found");
    store2.milestones = store2.milestones.filter((row) => row !== milestone);
    auditLog2("milestone.deleted", req.user.id, { milestoneId: milestone.id });
    persist2({ reason: "milestone-delete" });
    res.json({ ok: true });
  });
}

// src/server/routes/activity-alerts.routes.js
function registerActivityAlertRoutes(app2, services) {
  const { store: store2, sendError: sendError2, requireUser: requireUser2, requirePermission: requirePermission2, requireManager: requireManager2, validText: validText2, validEmail: validEmail2, customFieldInputError: customFieldInputError2, todayLA: todayLA2, timeLA: timeLA2, id: id2, personById: personById2, taskById: taskById2, projectById: projectById2, projectReferenceExists: projectReferenceExists2, taskReferenceExists: taskReferenceExists2, activityPublic: activityPublic2, alertPublic: alertPublic2, createActivityBlockerAlert: createActivityBlockerAlert2, can: can2, auditLog: auditLog2, persist: persist2, offlineCreateId: offlineCreateId2 } = services;
  app2.post("/api/activity", requireUser2, requirePermission2("logActivity"), (req, res) => {
    const body = req.body;
    const personId = body.personId === void 0 ? String(req.user.personId || "") : String(body.personId || "");
    const values = ["yesterday", "today", "blocked", "upcoming"].map((key) => typeof body[key] === "string" ? body[key].trim() : "");
    if (!personId || !personById2(personId)) return sendError2(res, 400, "A valid person is required for this activity update");
    if (personId !== String(req.user.personId || "") && !can2(req.user, "managePeople")) return sendError2(res, 403, "You may only log activity for your own profile");
    if (values.some((value) => value.length > 2e3)) return sendError2(res, 400, "Activity fields may not exceed 2000 characters");
    if (!values.some(Boolean)) return sendError2(res, 400, "Add at least one update before saving");
    const [yesterday, today, blocked, upcoming] = values;
    const customFieldError = customFieldInputError2("activities", body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const activity = { id: offlineCreateId2(req, "activities", () => id2("activity")), personId, date: todayLA2(), time: timeLA2(), yesterday, today, blocked, upcoming, status: "Confirmed", customFields: body.customFields || {}, sample: false };
    store2.activities.push(activity);
    const blockerResult = createActivityBlockerAlert2(activity);
    if (blockerResult?.created) auditLog2("alert.activity-blocker.created", req.user.id, { alertId: blockerResult.alert.id, activityId: activity.id });
    auditLog2("activity.logged", req.user.id, { activityId: activity.id, personId });
    persist2({ reason: "activity" });
    res.json(activityPublic2(activity, todayLA2()));
  });
  app2.put("/api/activity/:id", requireUser2, (req, res) => {
    const activity = store2.activities.find((row) => String(row.id) === String(req.params.id));
    if (!activity) return sendError2(res, 404, "Activity not found");
    const isAdministrator = req.user.role === "Administrator" && can2(req.user, "manageSettings");
    const isOwner = String(activity.personId || "") === String(req.user.personId || "");
    if (!isAdministrator && (!isOwner || !can2(req.user, "logActivity"))) return sendError2(res, 403, "You may only edit activity records for your own profile");
    const allowedFields = /* @__PURE__ */ new Set(["personId", "yesterday", "today", "blocked", "upcoming", "customFields"]);
    if (Object.keys(req.body || {}).some((key) => !allowedFields.has(key))) return sendError2(res, 400, "Activity updates contain unsupported fields");
    const personId = req.body.personId === void 0 ? String(activity.personId || "") : String(req.body.personId || "");
    if (personId !== String(activity.personId || "") && !isAdministrator) return sendError2(res, 403, "Only an administrator may change the person associated with activity");
    if (!personId || !personById2(personId)) return sendError2(res, 400, "A valid person is required for this activity update");
    const values = ["yesterday", "today", "blocked", "upcoming"].map((key) => req.body[key] === void 0 ? String(activity[key] || "") : typeof req.body[key] === "string" ? req.body[key].trim() : null);
    if (values.some((value) => value === null || value.length > 2e3)) return sendError2(res, 400, "Activity fields must be text of 2000 characters or fewer");
    if (!values.some(Boolean)) return sendError2(res, 400, "Add at least one update before saving");
    const customFields = req.body.customFields ?? activity.customFields ?? {};
    const customFieldError = customFieldInputError2("activities", customFields);
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const keys = ["yesterday", "today", "blocked", "upcoming"];
    const changedFields = keys.filter((key, index) => String(activity[key] || "") !== values[index]);
    const previousBlocked = String(activity.blocked || "");
    Object.assign(activity, Object.fromEntries(keys.map((key, index) => [key, values[index]])), { personId, customFields });
    if (String(activity.blocked || "") !== previousBlocked && String(activity.blocked || "").trim()) {
      const blockerResult = createActivityBlockerAlert2(activity);
      if (blockerResult?.created) auditLog2("alert.activity-blocker.created", req.user.id, { alertId: blockerResult.alert.id, activityId: activity.id });
    }
    auditLog2("activity.updated", req.user.id, { activityId: activity.id, personId, fields: changedFields });
    persist2({ reason: "activity-update" });
    res.json(activityPublic2(activity, todayLA2()));
  });
  app2.delete("/api/activity/:id", requireUser2, requirePermission2("manageTasks"), (req, res) => {
    const activity = store2.activities.find((row) => String(row.id) === String(req.params.id));
    if (!activity) return sendError2(res, 404, "Activity not found");
    const isAdministrator = req.user.role === "Administrator" && can2(req.user, "manageSettings");
    if (!isAdministrator && String(activity.personId || "") !== String(req.user.personId || "")) return sendError2(res, 403, "You may only delete activity records for your own profile");
    store2.activities = store2.activities.filter((row) => row !== activity);
    auditLog2("activity.deleted", req.user.id, { activityId: activity.id });
    persist2({ reason: "activity-delete" });
    res.json({ ok: true });
  });
  app2.post("/api/alerts", requireUser2, requirePermission2("manageAlerts"), (req, res) => {
    const body = req.body;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const task = body.taskId ? taskById2(body.taskId) : null;
    if (!validText2(title, 200)) return sendError2(res, 400, "Alert title is required and must be 200 characters or fewer");
    if (body.taskId && !task) return sendError2(res, 400, "Linked task does not exist");
    const projectId = body.projectId ? String(body.projectId) : task ? String(task.projectId) : "";
    const project = projectId ? projectById2(projectId) : null;
    if (projectId && !project) return sendError2(res, 400, "Linked project does not exist");
    if (task && project && String(task.projectId) !== String(project.id)) return sendError2(res, 400, "Linked task does not belong to the selected project");
    const type = body.type ?? "info";
    if (!["info", "deadline", "blocker", "risk"].includes(type)) return sendError2(res, 400, "Invalid alert type");
    if (typeof body.body !== "undefined" && (typeof body.body !== "string" || body.body.length > 4e3)) return sendError2(res, 400, "Alert details may not exceed 4000 characters");
    const customFieldError = customFieldInputError2("alerts", body.customFields ?? {});
    if (customFieldError) return sendError2(res, 400, customFieldError);
    const alert = { id: offlineCreateId2(req, "alerts", () => id2("alert")), title, body: body.body || "", type, tone: body.tone || (type === "risk" || type === "blocker" ? "orange" : "blue"), projectId: project?.id || "", taskId: task?.id || "", resolved: false, createdAt: todayLA2(), customFields: body.customFields || {}, sample: false };
    store2.alerts.push(alert);
    auditLog2("alert.created", req.user.id, { alertId: alert.id });
    persist2({ reason: "alert-create" });
    res.json(alertPublic2(alert));
  });
  app2.patch("/api/alerts/:id", requireUser2, (req, res) => {
    const alert = store2.alerts.find((row) => String(row.id) === String(req.params.id));
    if (!alert) return sendError2(res, 404, "Alert not found");
    const body = req.body;
    const editKeys = Object.keys(body).filter((key) => key !== "resolved");
    if (editKeys.length && !can2(req.user, "manageAlerts")) return sendError2(res, 403, "Manager or administrator access required to edit alerts");
    if (Object.hasOwn(body, "resolved") && typeof body.resolved !== "boolean") return sendError2(res, 400, "Resolved must be a boolean");
    if (!editKeys.length && Object.hasOwn(body, "resolved") && !can2(req.user, "manageAlerts")) {
      const linkedTask = alert.taskId ? taskById2(alert.taskId) : null;
      if (!can2(req.user, "writeTasks") || !linkedTask || !can2(req.user, "manageTasks") && String(linkedTask.assigneeId || "") !== String(req.user.personId || "")) return sendError2(res, 403, "You may only resolve alerts linked to tasks assigned to your profile");
    }
    if (!editKeys.length && !Object.hasOwn(body, "resolved")) return sendError2(res, 400, "No alert changes were provided");
    const title = body.title === void 0 ? alert.title : typeof body.title === "string" ? body.title.trim() : "";
    const taskId = body.taskId === void 0 ? alert.taskId : body.taskId || "";
    const task = taskId ? taskById2(taskId) : null;
    const projectId = body.projectId === void 0 ? String(alert.projectId || (task?.projectId ?? "")) : body.projectId ? String(body.projectId) : "";
    const project = projectId ? projectById2(projectId) : null;
    const type = body.type ?? alert.type;
    if (editKeys.includes("title") && !validText2(title, 200)) return sendError2(res, 400, "Alert title is required and must be 200 characters or fewer");
    if (taskId && !task) return sendError2(res, 400, "Linked task does not exist");
    if (projectId && !project) return sendError2(res, 400, "Linked project does not exist");
    if (task && project && String(task.projectId) !== String(project.id)) return sendError2(res, 400, "Linked task does not belong to the selected project");
    if (body.type !== void 0 && !["info", "deadline", "blocker", "risk"].includes(type)) return sendError2(res, 400, "Invalid alert type");
    if (body.body !== void 0 && (typeof body.body !== "string" || body.body.length > 4e3)) return sendError2(res, 400, "Alert details may not exceed 4000 characters");
    if (editKeys.length) {
      const customFieldError = customFieldInputError2("alerts", body.customFields ?? alert.customFields ?? {});
      if (customFieldError) return sendError2(res, 400, customFieldError);
    }
    if (editKeys.length) Object.assign(alert, { title, taskId: task?.id || "", projectId: project?.id || "", body: body.body ?? alert.body, type, tone: body.tone ?? alert.tone, customFields: body.customFields ?? alert.customFields ?? {} });
    if (typeof body.resolved === "boolean") alert.resolved = body.resolved;
    auditLog2("alert.updated", req.user.id, { alertId: alert.id, resolved: alert.resolved });
    persist2({ reason: "alert-update" });
    res.json(alertPublic2(alert));
  });
  app2.delete("/api/alerts/:id", requireUser2, requirePermission2("manageAlerts"), (req, res) => {
    const alert = store2.alerts.find((row) => String(row.id) === String(req.params.id));
    if (!alert) return sendError2(res, 404, "Alert not found");
    store2.alerts = store2.alerts.filter((row) => row !== alert);
    auditLog2("alert.deleted", req.user.id, { alertId: alert.id });
    persist2({ reason: "alert-delete" });
    res.json({ ok: true });
  });
}

// src/server/routes/users.routes.js
function registerUserRoutes(app2, services) {
  const { store: store2, sendError: sendError2, requireUser: requireUser2, requireAdmin: requireAdmin2, normalizeEmail: normalizeEmail2, validEmail: validEmail2, configuredPasswordMinLength: configuredPasswordMinLength2, MAX_PASSWORD_LENGTH: MAX_PASSWORD_LENGTH2, hashPassword: hashPassword2, publicAccessUser: publicAccessUser2, personById: personById2, id: id2, auditLog: auditLog2, persist: persist2, invalidateUserSessions: invalidateUserSessions2, auditRead: auditRead2, validText: validText2 } = services;
  app2.get("/api/users", requireUser2, requireAdmin2, (req, res) => {
    auditRead2("users", req.user.id);
    res.json(store2.users.map(publicAccessUser2));
  });
  app2.post("/api/users", requireUser2, requireAdmin2, (req, res) => {
    const body = req.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    const role = body.role ?? "Viewer";
    if (!validText2(name, 120) || !validEmail2(email) || typeof password !== "string" || password.length < configuredPasswordMinLength2() || password.length > MAX_PASSWORD_LENGTH2) return sendError2(res, 400, `Name, valid email, and a password of at least ${configuredPasswordMinLength2()} characters are required`);
    if (!Object.hasOwn(store2.settings.permissions.roles, role)) return sendError2(res, 400, "Unknown role");
    if (store2.users.some((user2) => normalizeEmail2(user2.email) === email)) return sendError2(res, 409, "A user with this email already exists");
    if (body.active !== void 0 && typeof body.active !== "boolean") return sendError2(res, 400, "Active must be a boolean");
    if (body.personId && !personById2(body.personId)) return sendError2(res, 400, "Linked person does not exist");
    let linkedPersonId = body.personId || "";
    if (!linkedPersonId) {
      const teamId = store2.teams[0]?.id || id2("team");
      if (!store2.teams.some((team) => team.id === teamId)) store2.teams.push({ id: teamId, name: "Workspace", color: "purple", sample: false });
      linkedPersonId = id2("person");
      store2.people.push({ id: linkedPersonId, name, email, jobTitle: role, teamId, focus: "Workspace access", capacity: 70, status: "On track", color: body.avatarColor || "purple", customFields: {}, sample: false });
    }
    const user = { id: id2("user"), name, email, passwordHash: hashPassword2(password), role, personId: linkedPersonId, avatarColor: typeof body.avatarColor === "string" ? body.avatarColor.slice(0, 40) : "purple", active: body.active !== false, createdAt: (/* @__PURE__ */ new Date()).toISOString(), sample: false };
    store2.users.push(user);
    auditLog2("user.created", req.user.id, { userId: user.id, role });
    persist2({ reason: "user-create" });
    res.json(publicAccessUser2(user));
  });
  app2.put("/api/users/:id", requireUser2, requireAdmin2, (req, res) => {
    const user = store2.users.find((item) => String(item.id) === String(req.params.id));
    if (!user) return sendError2(res, 404, "User not found");
    const body = req.body;
    const name = body.name === void 0 ? user.name : typeof body.name === "string" ? body.name.trim() : "";
    const email = body.email === void 0 ? user.email : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body.role ?? user.role;
    const active = body.active === void 0 ? user.active !== false : body.active;
    const personId = body.personId === void 0 ? user.personId : body.personId || "";
    if (!validText2(name, 120) || !validEmail2(email)) return sendError2(res, 400, "Name and a valid email address are required");
    if (store2.users.some((row) => row.id !== user.id && normalizeEmail2(row.email) === email)) return sendError2(res, 409, "A user with this email already exists");
    if (!Object.hasOwn(store2.settings.permissions.roles, role)) return sendError2(res, 400, "Unknown role");
    if (typeof active !== "boolean") return sendError2(res, 400, "Active must be a boolean");
    if (personId && !personById2(personId)) return sendError2(res, 400, "Linked person does not exist");
    if (body.password !== void 0 && body.password !== "" && (typeof body.password !== "string" || body.password.length < configuredPasswordMinLength2() || body.password.length > MAX_PASSWORD_LENGTH2)) return sendError2(res, 400, `Password must be between ${configuredPasswordMinLength2()} and ${MAX_PASSWORD_LENGTH2} characters`);
    if (user.role === "Administrator" && user.active !== false && (role !== "Administrator" || !active)) {
      const anotherActiveAdmin = store2.users.some((candidate) => candidate.id !== user.id && candidate.role === "Administrator" && candidate.active !== false);
      if (!anotherActiveAdmin) return sendError2(res, 400, "You cannot disable or demote the last active administrator");
    }
    Object.assign(user, { name, email, role, personId, avatarColor: typeof body.avatarColor === "string" ? body.avatarColor.slice(0, 40) : user.avatarColor, active });
    const passwordChanged = typeof body.password === "string" && body.password.length > 0;
    if (passwordChanged) {
      user.passwordHash = hashPassword2(body.password);
      delete user.password;
    }
    if (passwordChanged || !active) invalidateUserSessions2(user.id);
    auditLog2("user.updated", req.user.id, { userId: user.id, role: user.role, active: user.active, passwordChanged });
    persist2({ reason: "user-update" });
    res.json(publicAccessUser2(user));
  });
  app2.delete("/api/users/:id", requireUser2, requireAdmin2, (req, res) => {
    if (String(req.params.id) === String(req.user.id)) return sendError2(res, 400, "You cannot delete your own account");
    const target = store2.users.find((user) => String(user.id) === String(req.params.id));
    if (!target) return sendError2(res, 404, "User not found");
    if (target.role === "Administrator" && target.active !== false && store2.users.filter((user) => user.role === "Administrator" && user.active !== false && user.id !== target.id).length === 0) return sendError2(res, 400, "You cannot delete the last active administrator");
    store2.users = store2.users.filter((user) => user.id !== target.id);
    invalidateUserSessions2(target.id);
    auditLog2("user.deleted", req.user.id, { userId: target.id, role: target.role });
    persist2({ reason: "user-delete" });
    res.json({ ok: true });
  });
}

// src/server/routes/preferences.routes.js
var FILTER_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
var FIELD_PATTERN = /^[a-zA-Z0-9_.-]{1,120}$/;
var FILTER_OPERATORS = /* @__PURE__ */ new Set(["contains", "equals", "notEquals", "startsWith", "endsWith", "gt", "lt", "gte", "lte"]);
var FILTER_JOINS = /* @__PURE__ */ new Set(["AND", "OR"]);
var MAX_FILTERS = 25;
var MAX_CONDITIONS_PER_FILTER = 30;
var MAX_FILTER_VALUE_LENGTH = 2e3;
function normalizeFilters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_FILTERS) return null;
  const normalized = {};
  for (const [key, conditions] of entries) {
    if (!FILTER_KEY_PATTERN.test(key) || !Array.isArray(conditions) || conditions.length > MAX_CONDITIONS_PER_FILTER) return null;
    const normalizedConditions = [];
    for (const condition of conditions) {
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
      const { field: field3, operator, join, value: filterValue } = condition;
      if (typeof field3 !== "string" || !FIELD_PATTERN.test(field3)) return null;
      if (typeof operator !== "string" || !FILTER_OPERATORS.has(operator)) return null;
      if (join !== void 0 && (typeof join !== "string" || !FILTER_JOINS.has(join))) return null;
      if (typeof filterValue !== "string" || filterValue.length > MAX_FILTER_VALUE_LENGTH) return null;
      normalizedConditions.push({
        field: field3,
        operator,
        join: join || "AND",
        value: filterValue
      });
    }
    normalized[key] = normalizedConditions;
  }
  return normalized;
}
function registerPreferencesRoutes(app2, services) {
  const { requireUser: requireUser2, sendError: sendError2, userPreferencesRepository: userPreferencesRepository2 } = services;
  app2.get("/api/preferences", requireUser2, (req, res) => {
    res.json({ filters: userPreferencesRepository2.getFilters(req.user.id) });
  });
  app2.put("/api/preferences", requireUser2, (req, res) => {
    if (Object.keys(req.body || {}).some((key) => key !== "filters")) {
      return sendError2(res, 400, "Only saved filter preferences may be updated");
    }
    const filters = normalizeFilters(req.body?.filters);
    if (!filters) return sendError2(res, 400, "Saved filters contain invalid or oversized conditions");
    res.json({ filters: userPreferencesRepository2.saveFilters(req.user.id, filters) });
  });
}

// src/server/domain/export-data.js
var field2 = (label, type = "text") => ({ label, type });
var EXPORT_FIELD_SCHEMAS = {
  projects: {
    name: field2("Project"),
    code: field2("Code"),
    team: field2("Team"),
    health: field2("Health"),
    progress: field2("Progress", "percent"),
    deadline: field2("Deadline", "date"),
    status: field2("Status"),
    owner: field2("Owner"),
    description: field2("Description"),
    createdAt: field2("Created", "date")
  },
  tasks: {
    id: field2("Task ID"),
    title: field2("Task"),
    project: field2("Project"),
    status: field2("Status"),
    priority: field2("Priority"),
    assignee: field2("Assignee"),
    due: field2("Due", "date"),
    dueDate: field2("Due date", "date"),
    type: field2("Type"),
    blocked: field2("Blocked", "boolean"),
    tags: field2("Tags"),
    createdAt: field2("Created", "date"),
    completedAt: field2("Completed", "date")
  },
  people: {
    name: field2("Name"),
    email: field2("Email"),
    role: field2("Job title"),
    team: field2("Team"),
    status: field2("Status"),
    load: field2("Capacity", "percent"),
    focus: field2("Focus")
  },
  activity: {
    person: field2("Person"),
    date: field2("Date", "date"),
    time: field2("Time"),
    yesterday: field2("Yesterday"),
    today: field2("Today"),
    blocked: field2("Blocked"),
    upcoming: field2("Upcoming"),
    status: field2("Status")
  },
  alerts: {
    title: field2("Alert"),
    type: field2("Type"),
    project: field2("Project"),
    resolved: field2("Resolved", "boolean"),
    time: field2("Created", "date"),
    body: field2("Details"),
    source: field2("Source"),
    occurrences: field2("Occurrences", "number")
  },
  milestones: {
    name: field2("Milestone"),
    "project.name": field2("Project"),
    status: field2("Status"),
    dueDate: field2("Due date", "date")
  },
  users: {
    name: field2("Name"),
    email: field2("Email"),
    role: field2("Role"),
    team: field2("Team"),
    active: field2("Active", "boolean"),
    createdAt: field2("Created", "date")
  },
  "delivery-report": {
    label: field2("Period"),
    completed: field2("Completions", "number"),
    created: field2("New tasks", "number"),
    rate: field2("Completions / intake %", "percent")
  },
  "activity-evidence": {
    date: field2("Date", "date"),
    time: field2("Time"),
    person: field2("Person"),
    project: field2("Project"),
    taskId: field2("Task ID"),
    task: field2("Task / update"),
    action: field2("Action"),
    status: field2("Status"),
    summary: field2("Evidence"),
    minutes: field2("Minutes", "number"),
    source: field2("Source")
  },
  "activity-summary": {
    person: field2("Person"),
    role: field2("Job title"),
    team: field2("Team"),
    tasksTouched: field2("Tasks touched", "number"),
    completedTasks: field2("Completed", "number"),
    projects: field2("Projects", "number"),
    updates: field2("Updates", "number"),
    blockers: field2("Blockers", "number"),
    minutes: field2("Minutes", "number")
  },
  "project-contributions": {
    project: field2("Project"),
    projectCode: field2("Code"),
    tasksTouched: field2("Tasks touched", "number"),
    completedTasks: field2("Completed", "number"),
    users: field2("People", "number"),
    minutes: field2("Minutes", "number")
  }
};
function objectValue(row, key) {
  if (Object.hasOwn(row || {}, key)) return row[key];
  return String(key).split(".").reduce((value, part) => value?.[part], row);
}
var CUSTOM_FIELD_ENTITIES = { projects: "projects", tasks: "tasks", people: "people", activity: "activities", alerts: "alerts", milestones: "milestones" };
function exportFieldType(type) {
  if (type === "number") return "number";
  if (type === "date" || type === "datetime") return "date";
  if (type === "checkbox") return "boolean";
  return "text";
}
function schemaForDataset(dataset, snapshot) {
  const schema = { ...EXPORT_FIELD_SCHEMAS[dataset] };
  const entity = CUSTOM_FIELD_ENTITIES[dataset];
  const definitions = entity ? snapshot.settings?.customFields?.[entity] : [];
  for (const definition of definitions || []) {
    if (!definition || typeof definition.key !== "string" || definition.visible === false) continue;
    schema[`customFields.${definition.key}`] = field2(definition.label || definition.key, exportFieldType(definition.type));
  }
  return schema;
}
function sourceId(dataset, row) {
  if (dataset === "delivery-report") return row.key;
  if (dataset === "activity-summary") return row.personId;
  if (dataset === "project-contributions") return row.projectId;
  return row.__recordId ?? row.numericId ?? row.id;
}
function rowsForDataset(dataset, context, query) {
  const { snapshot, workspace, today } = context;
  const peopleById = new Map(snapshot.people.map((person) => [String(person.id), person]));
  const teamsById = new Map(snapshot.teams.map((team) => [String(team.id), team]));
  const projectsById = new Map(snapshot.projects.map((project) => [String(project.id), project]));
  const indexes = { people: peopleById, teams: teamsById, projects: projectsById };
  const tasksByProject = /* @__PURE__ */ new Map();
  snapshot.tasks.forEach((task) => {
    const key = String(task.projectId);
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key).push(task);
  });
  const projects = () => snapshot.projects.map((project) => ({
    ...workspace.projectPublic(project, today, tasksByProject.get(String(project.id)) || [], indexes),
    __recordId: project.id,
    deadline: project.deadline || "",
    createdAt: project.createdAt || ""
  }));
  const tasks = () => snapshot.tasks.map((task) => ({ ...workspace.taskPublic(task, today, indexes), __recordId: task.id, due: task.dueDate || "" }));
  if (dataset === "projects") return projects();
  if (dataset === "tasks") {
    const projectId = query.projectId == null ? "" : String(query.projectId);
    return tasks().filter((task) => !projectId || String(task.projectId) === projectId);
  }
  if (dataset === "people") return snapshot.people.map((person) => ({ ...workspace.personPublic(person), __recordId: person.id }));
  if (dataset === "activity") return snapshot.activities.filter((activity) => !query.personId || query.personId === "all" || String(activity.personId || "") === String(query.personId)).map((activity) => ({ ...workspace.activityPublic(activity, today), __recordId: activity.id }));
  if (dataset === "alerts") return snapshot.alerts.map((alert) => ({ ...workspace.alertPublic(alert), __recordId: alert.id, time: alert.createdAt || "" }));
  if (dataset === "milestones") return snapshot.milestones.map((milestone) => {
    const project = projectsById.get(String(milestone.projectId)) || {};
    return { ...milestone, project: { name: project.name || "Workspace", code: project.code || "" }, "project.name": project.name || "Workspace", __recordId: milestone.id };
  });
  if (dataset === "users") return snapshot.users.map((user) => {
    const person = peopleById.get(String(user.personId)) || {};
    const team = teamsById.get(String(person.teamId)) || {};
    return {
      __recordId: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      team: team.name || "Workspace",
      active: user.active !== false,
      createdAt: user.createdAt || ""
    };
  });
  if (dataset === "delivery-report") return workspace.reportFor(query.period).series;
  if (dataset === "activity-evidence" || dataset === "activity-summary" || dataset === "project-contributions") {
    const report = workspace.activityReportFor(query.period, query.personId || "all");
    if (dataset === "activity-evidence") return report.rows;
    if (dataset === "activity-summary") return report.users;
    return report.projects;
  }
  return null;
}
function prepareDatabaseExport({ context, dataset, recordIds, fields, query = {} }) {
  if (!Object.hasOwn(EXPORT_FIELD_SCHEMAS, dataset)) throw new Error("Unsupported export dataset");
  const schema = schemaForDataset(dataset, context.snapshot);
  if (fields !== void 0 && !Array.isArray(fields)) throw new Error("One or more export fields are unavailable for this dataset");
  const requested = fields === void 0 ? Object.keys(schema) : [...new Set(fields)];
  if (!requested.length) throw new Error("At least one export field is required");
  if (requested.length > 250 || requested.some((key) => typeof key !== "string" || !Object.hasOwn(schema, key))) throw new Error("One or more export fields are unavailable for this dataset");
  const sourceRows = rowsForDataset(dataset, context, query);
  if (!sourceRows) throw new Error("Unsupported export dataset");
  let rows = sourceRows;
  if (Array.isArray(recordIds)) {
    const selected = new Set(recordIds.map(String));
    rows = rows.filter((row) => selected.has(String(sourceId(dataset, row))));
  }
  if (Array.isArray(recordIds) && rows.length !== new Set(recordIds.map(String)).size) throw new Error("One or more selected database records are no longer available");
  const columns = requested.map((key) => ({ key, ...schema[key] }));
  const data = rows.map((row) => Object.fromEntries(requested.map((key) => [key, objectValue(row, key) ?? null])));
  return {
    dataset,
    source: "sqlite",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    recordCount: data.length,
    columns,
    rows: data
  };
}

// src/server/routes/exports.routes.js
var REPORT_DATASETS = /* @__PURE__ */ new Set(["delivery-report", "activity-evidence", "activity-summary", "project-contributions"]);
var ACTIVITY_DATASETS = /* @__PURE__ */ new Set(["activity-evidence", "activity-summary", "project-contributions"]);
var PERIODS = /* @__PURE__ */ new Set(["daily", "weekly", "monthly", "quarterly", "yearly"]);
var ACTIVITY_PERIODS = /* @__PURE__ */ new Set(["daily", "weekly", "monthly"]);
function registerExportRoutes(app2, services) {
  const { sendError: sendError2, requireUser: requireUser2, requirePermission: requirePermission2, can: can2, createDatabaseExportContext: createDatabaseExportContext2, isPlainObject: isPlainObject2 } = services;
  app2.post("/api/exports/prepare", requireUser2, requirePermission2("exportData"), (req, res) => {
    const { dataset, recordIds, fields, query: inputQuery } = req.body || {};
    if (typeof dataset !== "string" || dataset.length > 80) return sendError2(res, 400, "A supported export dataset is required");
    if (recordIds !== void 0 && (!Array.isArray(recordIds) || recordIds.some((id2) => !["string", "number"].includes(typeof id2) || String(id2).length > 200))) return sendError2(res, 400, "Selected record IDs are invalid");
    if (fields !== void 0 && (!Array.isArray(fields) || fields.length > 250 || fields.some((key) => typeof key !== "string" || key.length > 120 || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key)))) return sendError2(res, 400, "Selected export fields are invalid");
    if (inputQuery !== void 0 && !isPlainObject2(inputQuery)) return sendError2(res, 400, "Export query must be an object");
    const query = inputQuery || {};
    if (REPORT_DATASETS.has(dataset) && !can2(req.user, "viewReports")) return sendError2(res, 403, "Report access is required for this export");
    if (dataset === "users" && !can2(req.user, "manageUsers")) return sendError2(res, 403, "User administration access is required for this export");
    if (query.period !== void 0 && (typeof query.period !== "string" || !(ACTIVITY_DATASETS.has(dataset) ? ACTIVITY_PERIODS : PERIODS).has(query.period.toLowerCase()))) return sendError2(res, 400, "Unsupported report period for this dataset");
    if (query.personId !== void 0 && (typeof query.personId !== "string" || query.personId.length > 200)) return sendError2(res, 400, "Invalid person scope");
    if (query.projectId !== void 0 && !["string", "number"].includes(typeof query.projectId)) return sendError2(res, 400, "Invalid project scope");
    try {
      const context = createDatabaseExportContext2();
      const isAdministrator = req.user.role === "Administrator";
      const ownPersonId = String(req.user.personId || `unlinked:${req.user.id}`);
      const isPersonActivityDataset = dataset === "activity" || dataset === "activity-evidence" || dataset === "activity-summary";
      const personId = isAdministrator ? query.personId || "all" : isPersonActivityDataset ? ownPersonId : "all";
      const result = prepareDatabaseExport({
        context,
        dataset,
        recordIds,
        fields,
        query: {
          period: String(query.period || "weekly").toLowerCase(),
          personId,
          projectId: query.projectId
        }
      });
      res.json(result);
    } catch (error) {
      const status = /unsupported export dataset|fields are unavailable|export field is required|selected database records/i.test(error.message) ? 400 : 500;
      sendError2(res, status, status === 500 ? "Database export preparation failed" : error.message);
    }
  });
}

// src/server/routes/index.js
function registerRoutes(app2, services) {
  registerSystemRoutes(app2, services);
  registerTaskProjectRoutes(app2, services);
  registerDirectoryRoutes(app2, services);
  registerActivityAlertRoutes(app2, services);
  registerUserRoutes(app2, services);
  registerPreferencesRoutes(app2, services);
  registerExportRoutes(app2, services);
  app2.use("/api", (_req, res) => services.sendError(res, 404, "API route not found"));
}

// src/server/domain/settings.js
var DEFAULT_NAVIGATION = ["overview", "projects", "tasks", "people", "activity", "reports", "alerts"];
var DEFAULT_WORKFLOW_STATES = [
  { id: "todo", label: "To do", color: "muted", terminal: false },
  { id: "in_progress", label: "In progress", color: "blue", terminal: false },
  { id: "review", label: "Review", color: "purple", terminal: false },
  { id: "testing", label: "Testing", color: "orange", terminal: false },
  { id: "done", label: "Done", color: "green", terminal: true }
];
var DEFAULT_TRANSLATIONS = {
  en: { "app.name": "Atlas Workspace", "nav.overview": "Overview", "nav.projects": "Projects", "nav.tasks": "My work", "nav.people": "People", "nav.activity": "Activity", "nav.reports": "Reports", "nav.alerts": "Alerts", "nav.settings": "Settings", "actions.new": "New", "actions.search": "Search anything", "settings.localization": "Localization", "settings.workflows": "Workflows", "settings.permissions": "Permissions", "reports.activity": "User activity intelligence" },
  ar: { "app.name": "\u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0623\u0637\u0644\u0633", "nav.overview": "\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629", "nav.projects": "\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639", "nav.tasks": "\u0639\u0645\u0644\u064A", "nav.people": "\u0627\u0644\u0623\u0634\u062E\u0627\u0635", "nav.activity": "\u0627\u0644\u0646\u0634\u0627\u0637", "nav.reports": "\u0627\u0644\u062A\u0642\u0627\u0631\u064A\u0631", "nav.alerts": "\u0627\u0644\u062A\u0646\u0628\u064A\u0647\u0627\u062A", "nav.settings": "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A", "actions.new": "\u062C\u062F\u064A\u062F", "actions.search": "\u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0643\u0644 \u0634\u064A\u0621", "settings.localization": "\u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u062A\u0648\u0637\u064A\u0646", "settings.workflows": "\u0633\u064A\u0631 \u0627\u0644\u0639\u0645\u0644", "settings.permissions": "\u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", "reports.activity": "\u062A\u062D\u0644\u064A\u0644 \u0646\u0634\u0627\u0637 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646" },
  fa: { "app.name": "\u0641\u0636\u0627\u06CC \u06A9\u0627\u0631\u06CC \u0627\u0637\u0644\u0633", "nav.overview": "\u0646\u0645\u0627\u06CC \u06A9\u0644\u06CC", "nav.projects": "\u067E\u0631\u0648\u0698\u0647\u200C\u0647\u0627", "nav.tasks": "\u06A9\u0627\u0631\u0647\u0627\u06CC \u0645\u0646", "nav.people": "\u0627\u0641\u0631\u0627\u062F", "nav.activity": "\u0641\u0639\u0627\u0644\u06CC\u062A", "nav.reports": "\u06AF\u0632\u0627\u0631\u0634\u200C\u0647\u0627", "nav.alerts": "\u0647\u0634\u062F\u0627\u0631\u0647\u0627", "nav.settings": "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A", "actions.new": "\u062C\u062F\u06CC\u062F", "actions.search": "\u062C\u0633\u062A\u200C\u0648\u062C\u0648\u06CC \u0647\u0645\u0647 \u0686\u06CC\u0632", "settings.localization": "\u0628\u0648\u0645\u06CC\u200C\u0633\u0627\u0632\u06CC", "settings.workflows": "\u06AF\u0631\u062F\u0634\u200C\u06A9\u0627\u0631\u0647\u0627", "settings.permissions": "\u0645\u062C\u0648\u0632\u0647\u0627", "reports.activity": "\u0647\u0648\u0634\u0645\u0646\u062F\u06CC \u0641\u0639\u0627\u0644\u06CC\u062A \u06A9\u0627\u0631\u0628\u0631\u0627\u0646" },
  he: { "app.name": "\u05E1\u05D1\u05D9\u05D1\u05EA \u05D4\u05E2\u05D1\u05D5\u05D3\u05D4 Atlas", "nav.overview": "\u05E1\u05E7\u05D9\u05E8\u05D4", "nav.projects": "\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD", "nav.tasks": "\u05D4\u05E2\u05D1\u05D5\u05D3\u05D4 \u05E9\u05DC\u05D9", "nav.people": "\u05D0\u05E0\u05E9\u05D9\u05DD", "nav.activity": "\u05E4\u05E2\u05D9\u05DC\u05D5\u05EA", "nav.reports": "\u05D3\u05D5\u05D7\u05D5\u05EA", "nav.alerts": "\u05D4\u05EA\u05E8\u05D0\u05D5\u05EA", "nav.settings": "\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA", "actions.new": "\u05D7\u05D3\u05E9", "actions.search": "\u05D7\u05D9\u05E4\u05D5\u05E9 \u05D1\u05DB\u05DC \u05DE\u05E7\u05D5\u05DD", "settings.localization": "\u05DC\u05D5\u05E7\u05DC\u05D9\u05D6\u05E6\u05D9\u05D4", "settings.workflows": "\u05D6\u05E8\u05D9\u05DE\u05D5\u05EA \u05E2\u05D1\u05D5\u05D3\u05D4", "settings.permissions": "\u05D4\u05E8\u05E9\u05D0\u05D5\u05EA", "reports.activity": "\u05DE\u05D5\u05D3\u05D9\u05E2\u05D9\u05DF \u05E4\u05E2\u05D9\u05DC\u05D5\u05EA \u05DE\u05E9\u05EA\u05DE\u05E9\u05D9\u05DD" }
};
var ROLE_DESCRIPTIONS = {
  Administrator: "Full workspace ownership, security, settings, users, and all operational data.",
  Manager: "Manage projects, people, alerts, delivery plans, tasks, reports, and exports.",
  Developer: "Update task progress, log daily activity, and read/export operational reports.",
  Viewer: "Read-only access to dashboards, reports, exports, and team context."
};
function createSettingsService({
  ROLE_PERMISSIONS: ROLE_PERMISSIONS2,
  boundedInteger: boundedInteger2,
  isPlainObject: isPlainObject2,
  isValidTimezone: isValidTimezone2,
  id: id2,
  env = process.env,
  DATABASE_MODEL: DATABASE_MODEL2,
  STORE_SCHEMA_VERSION: STORE_SCHEMA_VERSION2,
  I18N_MISSING_LIMIT: I18N_MISSING_LIMIT2 = 2e3,
  DEFAULT_BACKUP_RETENTION: DEFAULT_BACKUP_RETENTION2 = 25,
  MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH2 = 8,
  cookieSecure: cookieSecure2 = false,
  allowDemoData: allowDemoData2 = false
}) {
  function roleRegistryDefaults2() {
    const ranks = { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 };
    return Object.fromEntries(Object.entries(ROLE_PERMISSIONS2).map(([name, permissions]) => [name, { name, description: ROLE_DESCRIPTIONS[name] || `${name} role`, permissions, rank: ranks[name] || 1, system: name === "Administrator" }]));
  }
  function defaultSettings2() {
    const settings = {
      workspace: {
        name: "Atlas Workspace",
        unit: "Operations",
        logo: "",
        applicationName: "Atlas Workspace",
        branding: { primaryColor: "#6d5dfc", accentColor: "purple", reportLogo: "", loginHeadline: "Operate with clarity." },
        organization: { legalName: "", website: "", address: "", contactEmail: "" },
        defaultTimezone: env.ATLAS_TIMEZONE || "America/Los_Angeles",
        defaultLanguage: "en",
        regionalFormats: { date: "MMM d, yyyy", number: "latn", currency: "USD", timezone: "short" },
        workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        workingHours: { start: "09:00", end: "17:00" },
        holidays: []
      },
      interface: {
        theme: "light",
        colors: { accent: "purple", primary: "#6d5dfc" },
        density: "comfortable",
        spacing: "comfortable",
        typography: { family: "Atlas Sans", scale: 100 },
        sidebarBehavior: "expanded",
        navigationVisibility: Object.fromEntries(DEFAULT_NAVIGATION.map((page) => [page, true])),
        navigationOrder: [...DEFAULT_NAVIGATION],
        dashboardLayouts: { overview: ["stats", "dailyPulse", "projectHealth", "myFocus"] },
        defaultLandingPage: "overview",
        tableBehavior: { pageSize: 50, stickyHeaders: true, zebraRows: false },
        tableColumns: { projects: ["name", "code", "team", "health", "progress", "deadline"], tasks: ["id", "title", "project", "status", "priority", "assignee", "due"], people: ["name", "email", "role", "team", "status", "load"], activity: ["person", "date", "today", "blocked"], alerts: ["title", "type", "project", "resolved", "time"], users: ["name", "email", "role", "team", "active"] },
        formLayouts: { projects: ["name", "code", "description", "teamId", "ownerId", "status", "deadline"], tasks: ["title", "projectId", "assigneeId", "priority", "dueDate", "status", "type", "blocked"], people: ["name", "email", "jobTitle", "teamId", "focus", "capacity", "status"], teams: ["name", "color"], milestones: ["name", "projectId", "dueDate", "status"], activities: ["personId", "yesterday", "today", "blocked", "upcoming"], alerts: ["title", "body", "type", "projectId"], users: ["name", "email", "role", "personId", "password", "active", "avatarColor"] },
        actionVisibility: { create: true, edit: true, delete: true, export: true, print: true },
        cardLayouts: { projects: "grid", tasks: "board" },
        animations: true,
        accessibility: { highContrast: false, reducedMotion: false, scalableText: 100, screenReaderLabels: true }
      },
      localization: {
        activeLanguages: ["en", "ar", "fa", "he"],
        defaultLanguage: "en",
        fallbackLanguage: "en",
        userLanguagePreference: true,
        textDirectionByLanguage: { en: "ltr", ar: "rtl", fa: "rtl", he: "rtl" },
        dateFormats: { en: "MMM d, yyyy", ar: "d MMM yyyy", fa: "yyyy/MM/dd", he: "d MMM yyyy" },
        numberFormats: { en: "latn", ar: "arab", fa: "arabext", he: "latn" },
        currencyFormats: { en: "USD", ar: "USD", fa: "USD", he: "USD" },
        timezoneFormats: { en: "short", ar: "short", fa: "short", he: "short" },
        translations: DEFAULT_TRANSLATIONS,
        missingTranslationDetection: true,
        languagePackages: [{ code: "en", name: "English", direction: "ltr", enabled: true }, { code: "ar", name: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", direction: "rtl", enabled: true }, { code: "fa", name: "\u0641\u0627\u0631\u0633\u06CC", direction: "rtl", enabled: true }, { code: "he", name: "\u05E2\u05D1\u05E8\u05D9\u05EA", direction: "rtl", enabled: true }],
        approvalWorkflow: { enabled: true, statusByKey: {} },
        interfaces: { core: { namespace: "core", label: "Core application", registeredAt: "built-in", status: "active" }, setup: { namespace: "setup", label: "First-run setup", registeredAt: "built-in", status: "active" }, settings: { namespace: "settings", label: "Configuration console", registeredAt: "built-in", status: "active" }, extensions: { namespace: "extensions", label: "Extension interfaces", registeredAt: "runtime", status: "active" } },
        missingKeys: [],
        translationMemory: [],
        keyPolicy: { prefixByNamespace: true, fallbackRequired: true, approvalRequired: true },
        runtime: { domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }
      },
      modules: {
        overview: { enabled: true, labelKey: "nav.overview", icon: "overview", permissions: ["viewReports"] },
        projects: { enabled: true, labelKey: "nav.projects", icon: "projects", permissions: ["manageProjects", "viewReports"] },
        tasks: { enabled: true, labelKey: "nav.tasks", icon: "tasks", permissions: ["writeTasks", "viewReports"] },
        people: { enabled: true, labelKey: "nav.people", icon: "people", permissions: ["managePeople", "viewReports"] },
        activity: { enabled: true, labelKey: "nav.activity", icon: "activity", permissions: ["logActivity", "viewReports"] },
        reports: { enabled: true, labelKey: "nav.reports", icon: "reports", permissions: ["viewReports"] },
        alerts: { enabled: true, labelKey: "nav.alerts", icon: "alerts", permissions: ["manageAlerts", "writeTasks", "viewReports"] }
      },
      workflows: {
        task: { name: "Default task workflow", states: DEFAULT_WORKFLOW_STATES, transitions: DEFAULT_WORKFLOW_STATES.slice(0, -1).map((state, index) => ({ from: state.label, to: DEFAULT_WORKFLOW_STATES[index + 1].label, permission: "writeTasks" })), approvalSteps: [], automatedActions: [] }
      },
      customFields: { projects: [], tasks: [], people: [], teams: [], milestones: [], activities: [], alerts: [], reports: [] },
      permissions: { roles: roleRegistryDefaults2(), moduleAccess: {}, fieldAccess: {}, actionAccess: {}, exportPermissions: {}, reportingPermissions: {} },
      notifications: { enabled: true, channels: { inApp: true, email: false, webhook: false }, events: { taskAssigned: true, alertCreated: true, reportReady: true } },
      reports: { defaultTemplate: "executive", templates: ["standard", "compact", "executive"], customColumns: {}, customFilters: {}, customCalculations: {}, localizedOutput: true, branding: { includeLogo: true, footerText: "" } },
      exports: { formats: ["csv", "xlsx", "json", "pdf", "print"], respectLanguage: true, respectDirection: true, includeBranding: true, pdf: { orientation: "landscape", margins: "standard" } },
      integrations: { registry: [], webhooks: [], apiAccess: false },
      storage: { model: DATABASE_MODEL2, schemaVersion: STORE_SCHEMA_VERSION2, backupRetention: DEFAULT_BACKUP_RETENTION2, importExportEnabled: true },
      security: { passwordMinLength: MIN_PASSWORD_LENGTH2, sessionDays: 14, cookieSecure: cookieSecure2, allowDemoData: allowDemoData2, requireApprovalForRoleChanges: false },
      audit: { enabled: true, retentionDays: 365, trackReads: false, trackWrites: true, trackExports: true },
      workLedger: { retentionMonths: 24 }
    };
    return withLegacySettings2(settings);
  }
  function mergeDeep2(target, source) {
    const out = isPlainObject2(target) ? { ...target } : {};
    if (!isPlainObject2(source)) return out;
    Object.entries(source).forEach(([key, value]) => {
      if (key === "__proto__" || key === "prototype" || key === "constructor") return;
      const previous = out[key];
      if (isPlainObject2(previous) && !isPlainObject2(value)) return;
      const merged = isPlainObject2(value) ? mergeDeep2(isPlainObject2(previous) ? previous : {}, value) : value;
      Object.defineProperty(out, key, { value: merged, enumerable: true, configurable: true, writable: true });
    });
    return out;
  }
  function withLegacySettings2(settings) {
    const visibility = settings.interface?.navigationVisibility || {};
    settings.language = settings.localization?.defaultLanguage || settings.workspace?.defaultLanguage || "en";
    settings.density = settings.interface?.density || "comfortable";
    settings.dateFormat = settings.workspace?.regionalFormats?.date || settings.localization?.dateFormats?.[settings.language] || "MMM d, yyyy";
    settings.defaultTaskView = settings.interface?.cardLayouts?.tasks || "board";
    settings.pageSize = Number(settings.interface?.tableBehavior?.pageSize || 50);
    settings.printTemplate = settings.reports?.defaultTemplate || "executive";
    settings.appMode = "adaptive";
    settings.theme = settings.interface?.theme || "light";
    settings.accentColor = settings.interface?.colors?.accent || "purple";
    settings.sidebarMode = settings.interface?.sidebarBehavior || "expanded";
    settings.defaultPage = settings.interface?.defaultLandingPage || "overview";
    settings.showAnimations = settings.interface?.animations !== false;
    settings.workspaceName = settings.workspace?.name || "Atlas Workspace";
    settings.workspaceUnit = settings.workspace?.unit || "Operations";
    const navOrder = Array.isArray(settings.interface?.navigationOrder) && settings.interface.navigationOrder.length ? settings.interface.navigationOrder : DEFAULT_NAVIGATION;
    settings.interface.navigationOrder = [.../* @__PURE__ */ new Set([...navOrder.filter((page) => DEFAULT_NAVIGATION.includes(page)), ...DEFAULT_NAVIGATION])].filter((page) => DEFAULT_NAVIGATION.includes(page));
    settings.enabledPages = settings.interface.navigationOrder.filter((page) => visibility[page] !== false && settings.modules?.[page]?.enabled !== false);
    return settings;
  }
  function normalizeSettings2(raw = {}) {
    const source = isPlainObject2(raw) ? raw : {};
    const next = mergeDeep2(defaultSettings2(), source);
    if (source.workspaceName && !source.workspace?.name) next.workspace.name = source.workspaceName;
    if (source.workspaceUnit && !source.workspace?.unit) next.workspace.unit = source.workspaceUnit;
    if (source.language && !source.localization?.defaultLanguage) {
      next.localization.defaultLanguage = source.language;
      next.workspace.defaultLanguage = source.language;
    }
    if (source.dateFormat && !source.workspace?.regionalFormats?.date) next.workspace.regionalFormats.date = source.dateFormat;
    if (source.theme && !source.interface?.theme) next.interface.theme = source.theme;
    if (source.accentColor && !source.interface?.colors?.accent) {
      next.interface.colors.accent = source.accentColor;
      next.workspace.branding.accentColor = source.accentColor;
    }
    if (source.density && !source.interface?.density) next.interface.density = source.density;
    if (source.sidebarMode && !source.interface?.sidebarBehavior) next.interface.sidebarBehavior = source.sidebarMode;
    if (source.defaultPage && !source.interface?.defaultLandingPage) next.interface.defaultLandingPage = source.defaultPage;
    if (source.defaultTaskView && !source.interface?.cardLayouts?.tasks) next.interface.cardLayouts.tasks = source.defaultTaskView;
    if (source.pageSize && !source.interface?.tableBehavior?.pageSize) next.interface.tableBehavior.pageSize = Number(source.pageSize);
    if (typeof source.showAnimations === "boolean" && typeof source.interface?.animations !== "boolean") next.interface.animations = source.showAnimations;
    if (Array.isArray(source.enabledPages) && !source.interface?.navigationVisibility && !source.modules) DEFAULT_NAVIGATION.forEach((page) => {
      next.interface.navigationVisibility[page] = source.enabledPages.includes(page);
      if (next.modules[page]) next.modules[page].enabled = source.enabledPages.includes(page);
    });
    const fallbackTimezone = isValidTimezone2(env.ATLAS_TIMEZONE) ? env.ATLAS_TIMEZONE : "America/Los_Angeles";
    if (!isValidTimezone2(next.workspace.defaultTimezone)) next.workspace.defaultTimezone = fallbackTimezone;
    next.security.passwordMinLength = boundedInteger2(next.security.passwordMinLength, MIN_PASSWORD_LENGTH2, MIN_PASSWORD_LENGTH2, 128);
    next.security.sessionDays = boundedInteger2(next.security.sessionDays, 14, 1, 365);
    next.security.cookieSecure = next.security.cookieSecure === true || cookieSecure2;
    next.storage.backupRetention = boundedInteger2(next.storage.backupRetention, DEFAULT_BACKUP_RETENTION2, 3, 100);
    next.audit.retentionDays = boundedInteger2(next.audit.retentionDays, 365, 1, 3650);
    next.workLedger.retentionMonths = boundedInteger2(next.workLedger.retentionMonths, 24, 0, 120);
    next.interface.tableBehavior.pageSize = boundedInteger2(next.interface.tableBehavior.pageSize, 50, 1, 500);
    const activeLanguages = Array.isArray(next.localization.activeLanguages) ? next.localization.activeLanguages.filter((code) => typeof code === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(code)) : ["en"];
    next.localization.activeLanguages = [...new Set(activeLanguages.length ? activeLanguages : ["en"])];
    if (!next.localization.activeLanguages.includes(next.localization.defaultLanguage)) next.localization.activeLanguages.push(next.localization.defaultLanguage || "en");
    next.localization.translations = isPlainObject2(next.localization.translations) ? next.localization.translations : {};
    next.localization.activeLanguages.forEach((code) => {
      const configured = next.localization.translations[code];
      next.localization.translations[code] = { ...DEFAULT_TRANSLATIONS[code] || {}, ...isPlainObject2(configured) ? configured : {} };
    });
    next.localization.interfaces = mergeDeep2({ core: { namespace: "core", label: "Core application", registeredAt: "built-in", status: "active" }, setup: { namespace: "setup", label: "First-run setup", registeredAt: "built-in", status: "active" }, settings: { namespace: "settings", label: "Configuration console", registeredAt: "built-in", status: "active" }, extensions: { namespace: "extensions", label: "Extension interfaces", registeredAt: "runtime", status: "active" } }, next.localization.interfaces);
    if (!Array.isArray(next.localization.missingKeys)) next.localization.missingKeys = [];
    next.localization.missingKeys = next.localization.missingKeys.slice(-I18N_MISSING_LIMIT2);
    if (!Array.isArray(next.localization.translationMemory)) next.localization.translationMemory = [];
    next.localization.translationMemory = next.localization.translationMemory.slice(-I18N_MISSING_LIMIT2);
    next.localization.keyPolicy = mergeDeep2({ prefixByNamespace: true, fallbackRequired: true, approvalRequired: true }, next.localization.keyPolicy);
    next.localization.runtime = mergeDeep2({ domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }, next.localization.runtime);
    next.permissions.roles = mergeDeep2(roleRegistryDefaults2(), next.permissions.roles);
    const administratorPermissions = next.permissions.roles.Administrator.permissions;
    next.permissions.roles.Administrator.permissions = [.../* @__PURE__ */ new Set([...Array.isArray(administratorPermissions) ? administratorPermissions : [], ...ROLE_PERMISSIONS2.Administrator])];
    if (!Array.isArray(next.permissions.roles.Administrator.permissions)) next.permissions.roles.Administrator.permissions = [...ROLE_PERMISSIONS2.Administrator];
    const configuredStates = next.workflows.task.states;
    const stateSource = Array.isArray(configuredStates) && configuredStates.length ? configuredStates : DEFAULT_WORKFLOW_STATES;
    const normalizedStates = [];
    const seenStateLabels = /* @__PURE__ */ new Set();
    stateSource.forEach((state, index) => {
      const rawLabel = typeof state === "string" ? state : isPlainObject2(state) ? state.label || state.name : "";
      const label = String(rawLabel || `State ${index + 1}`).trim().slice(0, 80);
      const key = label.toLocaleLowerCase();
      if (!label || seenStateLabels.has(key)) return;
      seenStateLabels.add(key);
      normalizedStates.push(typeof state === "string" ? { id: slugifyState2(label), label, color: index === stateSource.length - 1 ? "green" : "blue", terminal: index === stateSource.length - 1 } : { id: String(state?.id || slugifyState2(label)).slice(0, 80), label, color: String(state?.color || "blue").slice(0, 30), terminal: Boolean(state?.terminal || index === stateSource.length - 1) });
    });
    next.workflows.task.states = normalizedStates.length ? normalizedStates : DEFAULT_WORKFLOW_STATES.map((state) => ({ ...state }));
    if (!Array.isArray(next.workflows.task.transitions) || !next.workflows.task.transitions.length) next.workflows.task.transitions = next.workflows.task.states.slice(0, -1).map((state, index) => ({ from: state.label, to: next.workflows.task.states[index + 1].label, permission: "writeTasks" }));
    Object.keys(defaultSettings2().customFields).forEach((key) => {
      if (!Array.isArray(next.customFields[key])) next.customFields[key] = [];
    });
    return withLegacySettings2(next);
  }
  function settingsInputError2(value) {
    if (!isPlainObject2(value)) return "Settings must be a JSON object";
    const timezone = value.workspace?.defaultTimezone;
    if (timezone !== void 0 && !isValidTimezone2(timezone)) return "Workspace timezone must be a valid IANA timezone";
    const passwordLength = value.security?.passwordMinLength;
    if (passwordLength !== void 0 && (!Number.isInteger(Number(passwordLength)) || Number(passwordLength) < MIN_PASSWORD_LENGTH2 || Number(passwordLength) > 128)) return "Password minimum length must be between 8 and 128";
    const sessionDays = value.security?.sessionDays;
    if (sessionDays !== void 0 && (!Number.isInteger(Number(sessionDays)) || Number(sessionDays) < 1 || Number(sessionDays) > 365)) return "Session duration must be between 1 and 365 days";
    const backupRetention = value.storage?.backupRetention;
    if (backupRetention !== void 0 && (!Number.isInteger(Number(backupRetention)) || Number(backupRetention) < 3 || Number(backupRetention) > 100)) return "Backup retention must be between 3 and 100 files";
    const auditRetention = value.audit?.retentionDays;
    if (auditRetention !== void 0 && (!Number.isInteger(Number(auditRetention)) || Number(auditRetention) < 1 || Number(auditRetention) > 3650)) return "Audit retention must be between 1 and 3650 days";
    const workLedgerRetention = value.workLedger?.retentionMonths;
    if (workLedgerRetention !== void 0 && (!Number.isInteger(Number(workLedgerRetention)) || Number(workLedgerRetention) < 0 || Number(workLedgerRetention) > 120)) return "Work-ledger retention must be 0 (keep indefinitely) or 1 to 120 months";
    const states = value.workflows?.task?.states;
    if (states !== void 0) {
      if (!Array.isArray(states) || states.length < 1 || states.length > 50) return "Task workflow must contain between 1 and 50 states";
      const labels = states.map((state) => String(typeof state === "string" ? state : state?.label || state?.name || "").trim());
      if (labels.some((label) => !label || label.length > 80)) return "Workflow states must have names between 1 and 80 characters";
      if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) return "Workflow state names must be unique";
    }
    const customFields = value.customFields;
    if (customFields !== void 0) {
      if (!isPlainObject2(customFields)) return "Custom field definitions must be an object of field arrays";
      const allowedTypes = /* @__PURE__ */ new Set(["text", "number", "date", "datetime", "checkbox", "dropdown", "multi-select", "user", "attachment", "url", "calculated"]);
      for (const [entity, definitions] of Object.entries(customFields)) {
        if (!Array.isArray(definitions) || definitions.length > 200) return `Custom fields for ${entity} must be an array of at most 200 definitions`;
        const keys = /* @__PURE__ */ new Set();
        for (const field3 of definitions) {
          if (!isPlainObject2(field3) || typeof field3.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(field3.key) || ["__proto__", "prototype", "constructor"].includes(field3.key)) return `Custom fields for ${entity} need valid, non-empty field keys`;
          if (keys.has(field3.key)) return `Custom field key ${field3.key} is duplicated for ${entity}`;
          keys.add(field3.key);
          if (field3.type !== void 0 && !allowedTypes.has(field3.type)) return `Custom field ${field3.key} has an unsupported type`;
          if (field3.required !== void 0 && typeof field3.required !== "boolean") return `Required setting for ${field3.key} must be true or false`;
          if (field3.visible !== void 0 && typeof field3.visible !== "boolean") return `Visibility setting for ${field3.key} must be true or false`;
          if (field3.required === true && field3.visible === false) return `Required custom field ${field3.key} cannot be hidden`;
          if (field3.validation !== void 0 && (typeof field3.validation !== "string" || field3.validation.length > 200)) return `Validation metadata for ${field3.key} must be 200 characters or fewer`;
          if (field3.permissions !== void 0 && (!Array.isArray(field3.permissions) || field3.permissions.length > 50 || field3.permissions.some((permission) => typeof permission !== "string" || permission.length > 100))) return `Permission metadata for ${field3.key} is invalid`;
        }
      }
    }
    return "";
  }
  function slugifyState2(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || id2("state");
  }
  return { DEFAULT_NAVIGATION, DEFAULT_WORKFLOW_STATES, DEFAULT_TRANSLATIONS, ROLE_DESCRIPTIONS, roleRegistryDefaults: roleRegistryDefaults2, defaultSettings: defaultSettings2, mergeDeep: mergeDeep2, withLegacySettings: withLegacySettings2, normalizeSettings: normalizeSettings2, settingsInputError: settingsInputError2, slugifyState: slugifyState2 };
}

// src/server/domain/workspace.js
function createWorkspaceServices({ getStore, todayLA: todayLA2, addDays: addDays2, fmt, daysBetween: daysBetween2, isPlainObject: isPlainObject2, validIsoDate: validIsoDate2, permissionsFor: permissionsFor2, can: can2, isDone: isDone2, terminalTaskStates: terminalTaskStates2 }) {
  const store2 = new Proxy(/* @__PURE__ */ Object.create(null), {
    get(_target, property) {
      const current = getStore();
      return current == null ? void 0 : Reflect.get(current, property);
    },
    set(_target, property, value) {
      const current = getStore();
      if (current == null) throw new Error("Workspace state is not initialized");
      return Reflect.set(current, property, value);
    }
  });
  function taskCode(task) {
    const project = store2?.projects?.find((project2) => String(project2.id) === String(task.projectId)) || {};
    return `${project.code || "TASK"}-${String(task.id).padStart(3, "0")}`;
  }
  function teamById2(id2) {
    return store2.teams.find((t) => t.id === id2);
  }
  function personById2(id2) {
    return store2.people.find((p) => p.id === id2);
  }
  function projectById2(id2) {
    return store2.projects.find((p) => String(p.id) === String(id2));
  }
  function taskById2(id2) {
    return store2.tasks.find((t) => String(t.id) === String(id2));
  }
  function validText2(value, maxLength = 200) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
  }
  function validEmail2(value) {
    return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }
  function validDateValue2(value) {
    return validIsoDate2(value);
  }
  function validOptionalDate2(value) {
    return value === "" || value === void 0 || value === null || validDateValue2(value);
  }
  function validCustomFields2(value, depth = 0) {
    if (value === void 0 || value === null) return true;
    if (depth > 8) return false;
    if (typeof value === "string") return value.length <= 8e3;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length <= 1e3 && value.every((item) => validCustomFields2(item, depth + 1));
    if (!isPlainObject2(value)) return false;
    return Object.entries(value).length <= 1e3 && Object.entries(value).every(([key, item]) => key.length <= 200 && !["__proto__", "prototype", "constructor"].includes(key) && validCustomFields2(item, depth + 1));
  }
  function customFieldInputError2(entity, value) {
    const label = { projects: "Project", tasks: "Task", people: "Person", teams: "Team", milestones: "Milestone", activities: "Activity", alerts: "Alert" }[entity] || "Record";
    if (!validCustomFields2(value)) return `${label} custom fields contain invalid data`;
    const fields = store2.settings?.customFields?.[entity] || [];
    for (const field3 of fields) {
      if (!isPlainObject2(field3) || !field3.key) continue;
      const current = value?.[field3.key];
      const empty = current === void 0 || current === null || typeof current === "string" && !current.trim() || Array.isArray(current) && current.length === 0;
      if (field3.required && empty) return `${field3.label || field3.key} is required`;
      if (empty) continue;
      if (field3.type === "number" && (typeof current !== "number" && typeof current !== "string" || !Number.isFinite(Number(current)))) return `${field3.label || field3.key} must be a valid number`;
      if (field3.type === "date" && !validIsoDate2(current)) return `${field3.label || field3.key} must be a valid calendar date`;
      if (field3.type === "datetime" && (typeof current !== "string" || !Number.isFinite(Date.parse(current)))) return `${field3.label || field3.key} must be a valid date and time`;
      if (field3.type === "checkbox" && typeof current !== "boolean") return `${field3.label || field3.key} must be true or false`;
    }
    return "";
  }
  function personReferenceExists2(value) {
    return value === "" || value === null || value === void 0 || Boolean(personById2(value));
  }
  function teamReferenceExists2(value) {
    return value === "" || value === null || value === void 0 || Boolean(teamById2(value));
  }
  function projectReferenceExists2(value) {
    return value === "" || value === null || value === void 0 || Boolean(projectById2(value));
  }
  function taskReferenceExists2(value) {
    return value === "" || value === null || value === void 0 || Boolean(taskById2(value));
  }
  function publicUser2(user) {
    return user && { id: user.id, name: user.name, email: user.email, role: user.role, personId: user.personId, avatarColor: user.avatarColor, active: user.active !== false, permissions: permissionsFor2(user.role) };
  }
  function publicAccessUser2(user) {
    const person = personById2(user.personId) || {};
    return { ...publicUser2(user), personName: person.name || user.name, team: teamById2(person.teamId)?.name || "Workspace", lastLoginAt: user.lastLoginAt || "", createdAt: user.createdAt || "", sample: Boolean(user.sample) };
  }
  function dueTone2(task, today) {
    if (isDone2(task)) return "done";
    if (task.dueDate === today) return "today";
    if (task.dueDate && task.dueDate < today) return "overdue";
    return "soon";
  }
  function dueLabel2(task, today) {
    if (!task.dueDate) return "No date";
    const diff = daysBetween2(today, task.dueDate);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff < 0) return `${Math.abs(diff)}d late`;
    return fmt(task.dueDate);
  }
  function projectProgress2(project, projectTasks = store2.tasks.filter((task) => String(task.projectId) === String(project.id))) {
    if (!projectTasks.length) return 0;
    return Math.round(projectTasks.filter(isDone2).length / projectTasks.length * 100);
  }
  function projectHealth2(project, today, projectTasks = store2.tasks.filter((task) => String(task.projectId) === String(project.id))) {
    if (project.status === "Completed") return "Completed";
    if (project.status === "At risk") return "At risk";
    const overdue = projectTasks.some((task) => !isDone2(task) && task.dueDate && task.dueDate < today);
    return overdue ? "At risk" : "On track";
  }
  function taskPublic2(task, today, indexes = {}) {
    const project = indexes.projects?.get(String(task.projectId)) || projectById2(task.projectId) || {};
    const person = indexes.people?.get(String(task.assigneeId)) || personById2(task.assigneeId) || {};
    return {
      numericId: task.id,
      id: `${project.code || "TASK"}-${String(task.id).padStart(3, "0")}`,
      title: task.title,
      projectId: task.projectId,
      project: project.name || "Workspace",
      assigneeId: task.assigneeId,
      assignee: person.name || "Unassigned",
      assigneeColor: person.color || "purple",
      priority: task.priority || "Medium",
      dueDate: task.dueDate,
      due: dueLabel2(task, today),
      dueTone: dueTone2(task, today),
      status: task.status || "To do",
      type: task.type || "Development",
      blocked: Boolean(task.blocked),
      tags: Array.isArray(task.tags) ? task.tags : [],
      createdAt: task.createdAt,
      completedAt: task.completedAt || "",
      customFields: task.customFields || {}
    };
  }
  function projectPublic2(project, today, taskRows = void 0, indexes = {}) {
    const projectTasks = taskRows || store2.tasks.filter((task) => String(task.projectId) === String(project.id));
    const team = indexes.teams?.get(String(project.teamId)) || teamById2(project.teamId) || {};
    const owner = indexes.people?.get(String(project.ownerId)) || personById2(project.ownerId) || {};
    const memberIds = [...new Set(projectTasks.map((task) => task.assigneeId).concat(project.ownerId).filter(Boolean))];
    const members = memberIds.map((id2) => indexes.people?.get(String(id2)) || personById2(id2)).filter(Boolean);
    const milestoneRows = store2.milestones.filter((milestone) => String(milestone.projectId) === String(project.id)).map((milestone) => ({ ...milestone, projectId: project.id }));
    const diff = project.deadline ? daysBetween2(today, project.deadline) : null;
    return {
      id: `project-${project.id}`,
      numericId: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      createdAt: project.createdAt || "",
      teamId: project.teamId,
      team: team.name || "Workspace",
      ownerId: project.ownerId,
      owner: owner.name || "Unassigned",
      color: project.color || team.color || "purple",
      status: project.status,
      health: projectHealth2(project, today, projectTasks),
      progress: projectProgress2(project, projectTasks),
      deadlineDate: project.deadline,
      deadline: fmt(project.deadline),
      days: diff == null ? "No date" : diff < 0 ? `${Math.abs(diff)} days late` : `${diff} days`,
      members: members.map((p) => p.name),
      memberColors: Object.fromEntries(members.map((p) => [p.name, p.color])),
      milestoneRows,
      customFields: project.customFields || {}
    };
  }
  function personPublic2(person) {
    const team = teamById2(person.teamId) || {};
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      jobTitle: person.jobTitle,
      role: person.jobTitle,
      teamId: person.teamId,
      team: team.name || "Workspace",
      focus: person.focus,
      capacity: person.capacity,
      load: person.capacity,
      status: person.status,
      color: person.color || team.color || "purple",
      customFields: person.customFields || {}
    };
  }
  function activityPublic2(activity, today) {
    const person = personById2(activity.personId) || {};
    return { ...activity, customFields: activity.customFields || {}, person: person.name || "Unknown", personColor: person.color || "purple", isToday: activity.date === today };
  }
  function alertPublic2(alert) {
    const project = projectById2(alert.projectId) || {};
    return { ...alert, customFields: alert.customFields || {}, project: project.name || "Workspace", time: alert.createdAt ? fmt(alert.createdAt) : "Now" };
  }
  function dateKeyForValue(value) {
    if (value === null || value === void 0 || value === "") return "";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validIsoDate2(value) ? value : "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? todayLA2(date) : "";
  }
  function bucketFor2(period, dateValue, today) {
    const dateKey = dateKeyForValue(dateValue);
    if (!dateKey) return "";
    const date = /* @__PURE__ */ new Date(`${dateKey}T12:00:00Z`);
    const now = /* @__PURE__ */ new Date(`${today}T12:00:00Z`);
    if (period === "daily") return dateValue;
    if (period === "weekly") {
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      return date.toISOString().slice(0, 10);
    }
    if (period === "monthly") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (period === "quarterly") return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    return String(date.getUTCFullYear());
  }
  function makeBuckets2(period, today) {
    const base = /* @__PURE__ */ new Date(`${today}T12:00:00Z`);
    const buckets = [];
    const count = period === "daily" ? 10 : period === "weekly" ? 10 : period === "monthly" ? 12 : period === "quarterly" ? 8 : 5;
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(base);
      if (period === "daily") date.setUTCDate(base.getUTCDate() - i);
      if (period === "weekly") date.setUTCDate(base.getUTCDate() - i * 7);
      if (period === "monthly") date.setUTCMonth(base.getUTCMonth() - i, 1);
      if (period === "quarterly") date.setUTCMonth(base.getUTCMonth() - i * 3, 1);
      if (period === "yearly") date.setUTCFullYear(base.getUTCFullYear() - i, 0, 1);
      const iso = date.toISOString().slice(0, 10);
      const key = bucketFor2(period, iso, today);
      let label = fmt(iso, { month: "short", day: "numeric" });
      if (period === "weekly") label = `Wk ${fmt(key, { month: "short", day: "numeric" })}`;
      if (period === "monthly") label = fmt(iso, { month: "short" });
      if (period === "quarterly") label = key.split("-")[1];
      if (period === "yearly") label = String((/* @__PURE__ */ new Date(`${iso}T12:00:00Z`)).getUTCFullYear());
      buckets.push({ key, label, completed: 0, created: 0, planned: 0, rate: 0 });
    }
    return buckets;
  }
  function reportFor2(period = "weekly") {
    period = String(period).toLowerCase();
    if (!["daily", "weekly", "monthly", "quarterly", "yearly"].includes(period)) period = "weekly";
    const today = todayLA2();
    const buckets = makeBuckets2(period, today);
    const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]));
    store2.tasks.forEach((task) => {
      const createdKey = bucketFor2(period, task.createdAt || today, today);
      if (byKey[createdKey]) byKey[createdKey].created += 1;
      if (task.completedAt) {
        const completedKey = bucketFor2(period, task.completedAt, today);
        if (byKey[completedKey]) byKey[completedKey].completed += 1;
      }
    });
    buckets.forEach((bucket) => {
      bucket.planned = bucket.created;
      bucket.rate = bucket.created ? Math.round(bucket.completed / bucket.created * 100) : null;
    });
    const completed = buckets.reduce((sum, b) => sum + b.completed, 0);
    const created = buckets.reduce((sum, b) => sum + b.created, 0);
    const planned = created;
    const remainingTasks = store2.tasks.filter((t) => !isDone2(t)).length;
    const activeProjects = store2.projects.filter((p) => p.status !== "Completed").length;
    const completedProjects = store2.projects.filter((p) => p.status === "Completed").length;
    const blockedTasks = store2.tasks.filter((t) => t.blocked && !isDone2(t)).length;
    const overdue = store2.tasks.filter((t) => !isDone2(t) && t.dueDate && t.dueDate < today).length;
    const alerts = store2.alerts.filter((a) => !a.resolved).length;
    return {
      period,
      series: buckets,
      completed,
      created,
      planned,
      deliveryRate: planned ? Math.round(completed / planned * 100) : null,
      remainingTasks,
      activeProjects,
      completedProjects,
      blockedTasks,
      overdue,
      alerts,
      activities: store2.activities.filter((a) => buckets.some((b) => b.key === bucketFor2(period, a.date, today))).length
    };
  }
  function dashboard2(today, tasksPublic, projectsPublic, alertsPublic, user) {
    const openTasks = tasksPublic.filter((task) => !isDone2(task)).length;
    const activeProjects = projectsPublic.filter((project) => project.health !== "Completed").length;
    const atRisk = projectsPublic.filter((project) => project.health === "At risk").length;
    const onTrack = activeProjects ? Math.round((activeProjects - atRisk) / activeProjects * 100) : 100;
    const isAdministrator = user?.role === "Administrator";
    const personId = String(user?.personId || "");
    const visibleActivities = isAdministrator ? store2.activities : personId ? store2.activities.filter((activity) => String(activity.personId || "") === personId) : [];
    const todayActivities = visibleActivities.filter((activity) => activity.date === today);
    const yesterdayActivities = visibleActivities.filter((activity) => activity.date === addDays2(today, -1));
    const visibleTasks = personId ? tasksPublic.filter((task) => String(task.assigneeId || "") === personId) : [];
    const pulseItem = (activity, key, icon = "bolt") => {
      const person = personById2(activity.personId) || {};
      return { title: person.name || "Unknown", detail: activity[key] || "No update", time: activity.time || "", icon };
    };
    const weekStart = addDays2(today, -6);
    const teamActivity = store2.activities.filter((activity) => activity.date >= weekStart && activity.date <= today);
    const teamAggregate = {
      updatesToday: store2.activities.filter((activity) => activity.date === today).length,
      updatesYesterday: store2.activities.filter((activity) => activity.date === addDays2(today, -1)).length,
      updatesThisWeek: teamActivity.length,
      blockersToday: store2.activities.filter((activity) => activity.date === today && Boolean(activity.blocked)).length,
      blockedTasks: store2.tasks.filter((task) => task.blocked && !isDone2(task)).length
    };
    const blockedTasks = isAdministrator ? tasksPublic.filter((task) => task.blocked && !isDone2(task)) : visibleTasks.filter((task) => task.blocked && !isDone2(task));
    return {
      stats: {
        activeProjects,
        openTasks,
        needsAttention: store2.alerts.filter((alert) => !alert.resolved).length,
        onTrack,
        completedTasks: tasksPublic.filter((task) => isDone2(task)).length
      },
      dailyPulse: {
        yesterday: yesterdayActivities.slice(0, 4).map((activity) => pulseItem(activity, "yesterday", "check")),
        today: todayActivities.slice(0, 4).map((activity) => pulseItem(activity, "today", "bolt")),
        blocked: todayActivities.filter((activity) => activity.blocked).map((activity) => pulseItem(activity, "blocked", "warning")).concat(blockedTasks.slice(0, 3).map((task) => ({ title: task.title, detail: isAdministrator ? `${task.project} \xB7 ${task.assignee}` : task.project, time: task.due, icon: "warning" }))),
        upcoming: store2.milestones.slice(0, 4).map((milestone) => ({ title: milestone.name, detail: projectById2(milestone.projectId)?.name || "Project", time: fmt(milestone.dueDate), icon: "calendar" })),
        teamAggregate
      },
      myTasks: visibleTasks.filter((task) => !isDone2(task)).slice(0, 6)
    };
  }
  function settingsForUser2(user) {
    if (user?.role === "Administrator") return store2.settings;
    const source = store2.settings || {};
    const workspace = source.workspace || {};
    const ui = source.interface || {};
    const localization = source.localization || {};
    const customFields = Object.fromEntries(Object.entries(source.customFields || {}).map(([entity, definitions]) => [
      entity,
      Array.isArray(definitions) ? definitions.filter(isPlainObject2).map((definition) => ({
        key: definition.key,
        label: definition.label,
        type: definition.type,
        required: definition.required,
        visible: definition.visible,
        options: definition.options
      })) : []
    ]));
    const roles = Object.fromEntries(Object.entries(source.permissions?.roles || {}).map(([name, definition]) => [name, {
      name,
      summary: definition?.summary || definition?.description || name,
      description: definition?.description || definition?.summary || name
    }]));
    const modules = Object.fromEntries(Object.entries(source.modules || {}).map(([name, module]) => [name, {
      enabled: module?.enabled !== false,
      labelKey: module?.labelKey || `nav.${name}`,
      icon: module?.icon || name
    }]));
    return {
      workspace: {
        name: workspace.name,
        unit: workspace.unit,
        applicationName: workspace.applicationName,
        defaultTimezone: workspace.defaultTimezone,
        regionalFormats: workspace.regionalFormats,
        branding: { primaryColor: workspace.branding?.primaryColor, accentColor: workspace.branding?.accentColor, reportLogo: workspace.branding?.reportLogo }
      },
      workspaceName: source.workspaceName || workspace.name || "Atlas Workspace",
      workspaceUnit: source.workspaceUnit || workspace.unit || "Operations",
      interface: {
        theme: ui.theme,
        colors: ui.colors,
        density: ui.density,
        spacing: ui.spacing,
        typography: ui.typography,
        sidebarBehavior: ui.sidebarBehavior,
        navigationVisibility: ui.navigationVisibility,
        navigationOrder: ui.navigationOrder,
        dashboardLayouts: ui.dashboardLayouts,
        defaultLandingPage: ui.defaultLandingPage,
        tableBehavior: ui.tableBehavior,
        tableColumns: ui.tableColumns,
        formLayouts: ui.formLayouts,
        actionVisibility: ui.actionVisibility,
        cardLayouts: ui.cardLayouts,
        animations: ui.animations,
        accessibility: ui.accessibility
      },
      localization: {
        activeLanguages: localization.activeLanguages,
        defaultLanguage: localization.defaultLanguage,
        fallbackLanguage: localization.fallbackLanguage,
        userLanguagePreference: localization.userLanguagePreference,
        textDirectionByLanguage: localization.textDirectionByLanguage,
        dateFormats: localization.dateFormats,
        numberFormats: localization.numberFormats,
        currencyFormats: localization.currencyFormats,
        translations: localization.translations,
        languagePackages: localization.languagePackages
      },
      language: source.language || localization.defaultLanguage || "en",
      density: source.density || ui.density || "comfortable",
      dateFormat: source.dateFormat || workspace.regionalFormats?.date || "MMM d, yyyy",
      defaultTaskView: source.defaultTaskView || ui.cardLayouts?.tasks || "board",
      pageSize: source.pageSize || ui.tableBehavior?.pageSize || 50,
      printTemplate: source.printTemplate || source.reports?.defaultTemplate || "executive",
      theme: source.theme || ui.theme || "light",
      accentColor: source.accentColor || ui.colors?.accent || "purple",
      sidebarMode: source.sidebarMode || ui.sidebarBehavior || "expanded",
      defaultPage: source.defaultPage || ui.defaultLandingPage || "overview",
      showAnimations: source.showAnimations !== false && ui.animations !== false,
      enabledPages: source.enabledPages || [],
      workflows: { task: { states: source.workflows?.task?.states || [] } },
      permissions: { roles },
      modules,
      customFields,
      exports: {
        formats: source.exports?.formats || ["csv", "xlsx", "json", "pdf", "print"],
        includeBranding: source.exports?.includeBranding !== false,
        pdf: { orientation: source.exports?.pdf?.orientation || "landscape", margins: source.exports?.pdf?.margins || "standard" }
      },
      reports: { defaultTemplate: source.reports?.defaultTemplate || "executive" }
    };
  }
  function bootstrapFor2(user) {
    const today = todayLA2();
    const isAdministrator = user?.role === "Administrator";
    const peopleById = new Map(store2.people.map((person) => [String(person.id), person]));
    const projectsById = new Map(store2.projects.map((project) => [String(project.id), project]));
    const teamsById = new Map(store2.teams.map((team) => [String(team.id), team]));
    const tasksByProject = /* @__PURE__ */ new Map();
    for (const task of store2.tasks) {
      const key = String(task.projectId);
      if (!tasksByProject.has(key)) tasksByProject.set(key, []);
      tasksByProject.get(key).push(task);
    }
    const teams = store2.teams.map((team) => ({ ...team, peopleCount: store2.people.filter((person) => person.teamId === team.id).length }));
    const people = store2.people.map(personPublic2);
    const indexes = { people: peopleById, projects: projectsById, teams: teamsById };
    const projects = store2.projects.map((project) => projectPublic2(project, today, tasksByProject.get(String(project.id)) || [], indexes));
    const tasks = store2.tasks.map((task) => taskPublic2(task, today, indexes)).sort((left, right) => String(left.dueDate || "").localeCompare(String(right.dueDate || "")));
    const visibleActivities = isAdministrator ? store2.activities : user?.personId ? store2.activities.filter((activity2) => String(activity2.personId || "") === String(user.personId)) : [];
    const activity = visibleActivities.map((row) => activityPublic2(row, today)).sort((left, right) => `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`));
    const visibleAlerts = isAdministrator ? store2.alerts : store2.alerts.filter((alert) => alert.source !== "activity-blocker" || String(alert.personId || "") === String(user?.personId || ""));
    const alerts = visibleAlerts.map(alertPublic2).sort((left, right) => Number(left.resolved) - Number(right.resolved) || String(right.createdAt).localeCompare(String(left.createdAt)));
    const users = isAdministrator && can2(user, "manageUsers") ? store2.users.map(publicAccessUser2) : [];
    const teamActivitySummary = {
      today: store2.activities.filter((activityRow) => activityRow.date === today).length,
      yesterday: store2.activities.filter((activityRow) => activityRow.date === addDays2(today, -1)).length,
      thisWeek: store2.activities.filter((activityRow) => activityRow.date >= addDays2(today, -6) && activityRow.date <= today).length,
      blockersToday: store2.activities.filter((activityRow) => activityRow.date === today && Boolean(activityRow.blocked)).length
    };
    return {
      today,
      user: publicUser2(user),
      settings: settingsForUser2(user),
      teams,
      people,
      users,
      projects,
      tasks,
      activity,
      alerts,
      teamActivitySummary,
      dashboard: dashboard2(today, tasks, projects, alerts, user),
      reports: reportFor2("weekly")
    };
  }
  function workLogPublic2(log, period = "daily") {
    const person = personById2(log.personId) || {};
    const project = projectById2(log.projectId) || {};
    const task = log.taskId ? taskById2(log.taskId) : null;
    const projectCode = project.code || log.projectCode || "";
    return {
      id: log.id,
      date: log.date,
      time: log.time || "",
      periodKey: bucketFor2(period, log.date, todayLA2()),
      periodLabel: bucketLabel2(period, log.date),
      personId: log.personId,
      person: person.name || "Unknown",
      role: person.jobTitle || "",
      projectId: log.projectId || "",
      project: project.name || log.projectName || "Workspace",
      projectCode,
      taskId: task ? taskCode(task) : log.taskId ? `${projectCode || "TASK"}-${String(log.taskId).padStart(3, "0")}` : "",
      taskNumericId: log.taskId || "",
      task: task?.title || log.taskTitle || (log.taskId ? "Deleted task" : "Daily update"),
      action: log.action || "Task event",
      statusFrom: log.statusFrom || "",
      statusTo: log.statusTo || "",
      status: log.statusTo || log.action || "Task event",
      summary: log.summary || "",
      minutes: Math.max(0, Number(log.minutes) || 0),
      source: log.source || "Task event"
    };
  }
  function bucketLabel2(period, dateValue) {
    if (period === "daily") return fmt(dateValue, { weekday: "short", month: "short", day: "numeric" });
    if (period === "weekly") return `Week of ${fmt(bucketFor2("weekly", dateValue, todayLA2()), { month: "short", day: "numeric" })}`;
    if (period === "monthly") return fmt(`${dateValue.slice(0, 7)}-01`, { month: "long", year: "numeric" });
    return fmt(dateValue);
  }
  function isCompletionEvent2(row) {
    if (!row.taskNumericId) return false;
    const terminal = terminalTaskStates2();
    const wasDone = terminal.includes(row.statusFrom) || row.statusFrom === "Done";
    const isNowDone = terminal.includes(row.statusTo) || row.statusTo === "Done";
    if (isNowDone && !wasDone) return true;
    return !row.statusFrom && /^(created and completed|completed task)$/i.test(row.action || "");
  }
  function completedTaskIds2(rows) {
    return new Set(rows.filter(isCompletionEvent2).map((row) => String(row.taskNumericId)));
  }
  function activityReportFor2(period = "weekly", userId = "all") {
    period = String(period).toLowerCase();
    if (!["daily", "weekly", "monthly"].includes(period)) period = "weekly";
    const today = todayLA2();
    const buckets = makeBuckets2(period, today).slice(period === "daily" ? -14 : period === "weekly" ? -8 : -12);
    const bucketKeys = new Set(buckets.map((bucket) => bucket.key));
    const includeUser = (value) => !userId || userId === "all" || String(value) === String(userId);
    const detailRows = (store2.workLogs || []).filter((log) => log.taskId).map((log) => workLogPublic2(log, period)).filter((row) => bucketKeys.has(row.periodKey) && includeUser(row.personId));
    const activityRows = store2.activities.map((activity) => {
      const person = personById2(activity.personId) || {};
      return {
        id: `activity_${activity.id}`,
        date: activity.date,
        time: activity.time || "",
        periodKey: bucketFor2(period, activity.date, today),
        periodLabel: bucketLabel2(period, activity.date),
        personId: activity.personId,
        person: person.name || "Unknown",
        role: person.jobTitle || "",
        projectId: "",
        project: "Workspace",
        projectCode: "",
        taskId: "",
        taskNumericId: "",
        task: "Daily update",
        action: activity.blocked ? "Raised blocker" : "Logged update",
        statusFrom: "",
        statusTo: activity.blocked ? "Blocked" : "Confirmed",
        status: activity.blocked ? "Blocked" : "Confirmed",
        summary: [activity.yesterday && `Yesterday: ${activity.yesterday}`, activity.today && `Today: ${activity.today}`, activity.blocked && `Blocked: ${activity.blocked}`, activity.upcoming && `Upcoming: ${activity.upcoming}`].filter(Boolean).join(" | "),
        minutes: 0,
        source: "Activity log"
      };
    }).filter((row) => bucketKeys.has(row.periodKey) && includeUser(row.personId));
    const allRows = [...detailRows, ...activityRows].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const people = store2.people.filter((person) => includeUser(person.id));
    const userSummaries = people.map((person) => {
      const rows = allRows.filter((row) => row.personId === person.id);
      const taskRows = rows.filter((row) => row.taskNumericId);
      const projectKeys = new Set(taskRows.map((row) => String(row.projectId || row.project)).filter(Boolean));
      return {
        personId: person.id,
        person: person.name,
        role: person.jobTitle,
        team: teamById2(person.teamId)?.name || "Workspace",
        tasksTouched: new Set(taskRows.map((row) => String(row.taskNumericId))).size,
        completedTasks: completedTaskIds2(taskRows).size,
        projects: projectKeys.size,
        updates: rows.filter((row) => row.source === "Activity log").length,
        blockers: rows.filter((row) => row.statusTo === "Blocked" || row.summary.toLowerCase().includes("blocked")).length,
        minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
      };
    }).filter((summary) => summary.tasksTouched || summary.updates || userId !== "all");
    const projectGroups = /* @__PURE__ */ new Map();
    allRows.filter((row) => row.projectId && row.project !== "Workspace").forEach((row) => {
      const key = String(row.projectId || row.project);
      const group = projectGroups.get(key) || { projectId: row.projectId, project: row.project, projectCode: row.projectCode, taskIds: /* @__PURE__ */ new Set(), completedIds: /* @__PURE__ */ new Set(), users: /* @__PURE__ */ new Set(), minutes: 0 };
      if (row.taskNumericId) group.taskIds.add(String(row.taskNumericId));
      if (isCompletionEvent2(row)) group.completedIds.add(String(row.taskNumericId));
      if (row.person) group.users.add(row.person);
      group.minutes += Number(row.minutes || 0);
      projectGroups.set(key, group);
    });
    const projectSummaries = [...projectGroups.values()].map((group) => ({ projectId: group.projectId, project: group.project, projectCode: group.projectCode, tasksTouched: group.taskIds.size, completedTasks: group.completedIds.size, users: group.users.size, minutes: group.minutes }));
    const series = buckets.map((bucket) => {
      const rows = allRows.filter((row) => row.periodKey === bucket.key);
      const taskRows = rows.filter((row) => row.taskNumericId);
      return {
        key: bucket.key,
        label: bucket.label,
        tasksTouched: new Set(taskRows.map((row) => String(row.taskNumericId))).size,
        completedTasks: completedTaskIds2(taskRows).size,
        users: new Set(rows.map((row) => row.personId).filter(Boolean)).size,
        updates: rows.filter((row) => row.source === "Activity log").length,
        minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
      };
    });
    return {
      period,
      userId,
      scope: userId === "all" ? "All people" : personById2(userId)?.name || "Selected person",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      series,
      users: userSummaries,
      projects: projectSummaries,
      rows: allRows,
      totals: {
        tasksTouched: new Set(allRows.filter((row) => row.taskNumericId).map((row) => String(row.taskNumericId))).size,
        completedTasks: completedTaskIds2(allRows).size,
        activeUsers: new Set(allRows.map((row) => row.personId).filter(Boolean)).size,
        projects: projectSummaries.length,
        updates: allRows.filter((row) => row.source === "Activity log").length,
        blockers: allRows.filter((row) => row.statusTo === "Blocked" || row.summary.toLowerCase().includes("blocked")).length,
        minutes: allRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
      }
    };
  }
  function nextProjectId2() {
    const value = store2.counters.project || store2.projects.reduce((maximum, project) => Math.max(maximum, Number(project.id) || 0), 0) + 1;
    store2.counters.project = value + 1;
    return value;
  }
  function nextTaskId2() {
    const value = store2.counters.task || store2.tasks.reduce((maximum, task) => Math.max(maximum, Number(task.id) || 0), 0) + 1;
    store2.counters.task = value + 1;
    return value;
  }
  return { teamById: teamById2, personById: personById2, projectById: projectById2, taskById: taskById2, validText: validText2, validEmail: validEmail2, validDateValue: validDateValue2, validOptionalDate: validOptionalDate2, validCustomFields: validCustomFields2, customFieldInputError: customFieldInputError2, personReferenceExists: personReferenceExists2, teamReferenceExists: teamReferenceExists2, projectReferenceExists: projectReferenceExists2, taskReferenceExists: taskReferenceExists2, publicUser: publicUser2, publicAccessUser: publicAccessUser2, dueTone: dueTone2, dueLabel: dueLabel2, projectProgress: projectProgress2, projectHealth: projectHealth2, taskPublic: taskPublic2, projectPublic: projectPublic2, personPublic: personPublic2, activityPublic: activityPublic2, alertPublic: alertPublic2, bucketFor: bucketFor2, makeBuckets: makeBuckets2, reportFor: reportFor2, dashboard: dashboard2, settingsForUser: settingsForUser2, bootstrapFor: bootstrapFor2, workLogPublic: workLogPublic2, bucketLabel: bucketLabel2, isCompletionEvent: isCompletionEvent2, completedTaskIds: completedTaskIds2, activityReportFor: activityReportFor2, nextProjectId: nextProjectId2, nextTaskId: nextTaskId2 };
}

// src/server/domain/security.js
import crypto2 from "node:crypto";
var ROLE_PERMISSIONS = {
  Administrator: ["manageSettings", "manageUsers", "manageProjects", "managePeople", "manageAlerts", "manageTasks", "writeTasks", "logActivity", "viewReports", "exportData", "removeDemoData"],
  Manager: ["manageProjects", "managePeople", "manageAlerts", "manageTasks", "writeTasks", "logActivity", "viewReports", "exportData"],
  Developer: ["writeTasks", "logActivity", "viewReports", "exportData"],
  Viewer: ["viewReports", "exportData"]
};
function createSecurityService({ getStore, boundedInteger: boundedInteger2, sessions: sessions2 = /* @__PURE__ */ new Map(), cookieSecure: cookieSecure2 = false, minPasswordLength = 8, maxPasswordLength = 1024, sessionTokenBytes = 32 }) {
  function configuredSessionDays() {
    return boundedInteger2(getStore()?.settings?.security?.sessionDays, 14, 1, 365);
  }
  function configuredPasswordMinLength2() {
    return Math.max(minPasswordLength, boundedInteger2(getStore()?.settings?.security?.passwordMinLength, minPasswordLength, minPasswordLength, 128));
  }
  function sessionCookieOptions2() {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure2 || getStore()?.settings?.security?.cookieSecure === true,
      maxAge: 1e3 * 60 * 60 * 24 * configuredSessionDays(),
      path: "/"
    };
  }
  function newSession2(userId) {
    const token = crypto2.randomBytes(sessionTokenBytes).toString("base64url");
    sessions2.set(token, { userId, expiresAt: Date.now() + 1e3 * 60 * 60 * 24 * configuredSessionDays() });
    if (sessions2.size > 5e3) {
      const now = Date.now();
      for (const [key, session] of sessions2) if (!session || session.expiresAt <= now) sessions2.delete(key);
    }
    return token;
  }
  function invalidateUserSessions2(userId) {
    for (const [token, session] of sessions2) if (session?.userId === userId) sessions2.delete(token);
  }
  function hashPassword2(password) {
    const salt = crypto2.randomBytes(16).toString("hex");
    const key = crypto2.scryptSync(String(password), salt, 64).toString("hex");
    return `scrypt$${salt}$${key}`;
  }
  function verifyPassword2(password, user) {
    const stored = user?.passwordHash || user?.password || "";
    if (!stored) return false;
    if (!stored.startsWith("scrypt$")) return stored === password;
    const [, salt, key] = stored.split("$");
    if (!salt || !key) return false;
    const candidate = crypto2.scryptSync(String(password), salt, 64);
    const original = Buffer.from(key, "hex");
    return original.length === candidate.length && crypto2.timingSafeEqual(candidate, original);
  }
  function normalizeUserSecrets2(user) {
    if (user.password && !user.passwordHash) user.passwordHash = hashPassword2(user.password);
    delete user.password;
    return user;
  }
  function validatePassword2(value) {
    return typeof value === "string" && value.length >= configuredPasswordMinLength2() && value.length <= maxPasswordLength;
  }
  function permissionsFor2(role = "Viewer") {
    const configured = getStore()?.settings?.permissions?.roles?.[role]?.permissions;
    return Array.isArray(configured) ? configured : ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Viewer;
  }
  function can2(user, permission) {
    return permissionsFor2(user?.role).includes(permission);
  }
  function roleRank2(role) {
    const rank = Number(getStore()?.settings?.permissions?.roles?.[role]?.rank);
    if (Number.isFinite(rank)) return rank;
    return { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 }[role] || 1;
  }
  return {
    sessions: sessions2,
    configuredSessionDays,
    configuredPasswordMinLength: configuredPasswordMinLength2,
    sessionCookieOptions: sessionCookieOptions2,
    newSession: newSession2,
    invalidateUserSessions: invalidateUserSessions2,
    hashPassword: hashPassword2,
    verifyPassword: verifyPassword2,
    normalizeUserSecrets: normalizeUserSecrets2,
    validatePassword: validatePassword2,
    permissionsFor: permissionsFor2,
    can: can2,
    roleRank: roleRank2
  };
}

// src/server/domain/store.js
import crypto3 from "node:crypto";
function createStoreService({
  getStore,
  todayLA: todayLA2,
  timeLA: timeLA2,
  addDays: addDays2,
  id: id2,
  parseNumber: parseNumber2,
  isPlainObject: isPlainObject2,
  defaultSettings: defaultSettings2,
  normalizeSettings: normalizeSettings2,
  hashPassword: hashPassword2,
  normalizeUserSecrets: normalizeUserSecrets2,
  allowDemoData: allowDemoData2,
  STORE_SCHEMA_VERSION: STORE_SCHEMA_VERSION2,
  DATABASE_MODEL: DATABASE_MODEL2,
  DESIGN_SYSTEM_VERSION: DESIGN_SYSTEM_VERSION2,
  configuredBackupRetention: configuredBackupRetention2
}) {
  const store2 = new Proxy(/* @__PURE__ */ Object.create(null), {
    get(_target, property) {
      const current = getStore();
      return current == null ? void 0 : Reflect.get(current, property);
    },
    set(_target, property, value) {
      const current = getStore();
      if (current == null) throw new Error("Workspace state is not initialized");
      return Reflect.set(current, property, value);
    }
  });
  function newStoreMeta2(overrides = {}) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      ...overrides,
      createdAt: overrides.createdAt || now,
      updatedAt: now,
      writeCount: Number(overrides.writeCount || 0),
      lastMigrationAt: overrides.lastMigrationAt || now,
      designSystemVersion: DESIGN_SYSTEM_VERSION2,
      schemaVersion: STORE_SCHEMA_VERSION2,
      model: DATABASE_MODEL2,
      atomicPersistence: true,
      backupRetention: Number(overrides.backupRetention || configuredBackupRetention2())
    };
  }
  function buildSeedWorkLogs2(tasks = [], activities = []) {
    const logs = [];
    tasks.forEach((task, index) => {
      const date = task.completedAt || task.createdAt || todayLA2();
      logs.push({
        id: `wl_seed_${task.id}_${index}`,
        personId: task.assigneeId,
        taskId: task.id,
        projectId: task.projectId,
        action: task.completedAt ? "Completed task" : task.status === "To do" ? "Planned task" : "Moved task",
        statusFrom: task.completedAt ? "Testing" : "To do",
        statusTo: task.status,
        summary: `${task.title} \xB7 ${task.type || "Work"} \xB7 ${task.priority || "Medium"} priority`,
        date,
        time: ["09:10", "10:25", "13:40", "15:15"][index % 4],
        minutes: 0,
        sample: Boolean(task.sample)
      });
    });
    activities.forEach((activity, index) => {
      if (!activity.today && !activity.yesterday && !activity.blocked) return;
      logs.push({ id: `wl_activity_${activity.id}`, personId: activity.personId, taskId: "", projectId: "", action: "Daily update", statusFrom: "", statusTo: activity.blocked ? "Blocked" : "Confirmed", summary: activity.blocked ? `${activity.today || "Daily focus"} \xB7 Blocked: ${activity.blocked}` : activity.today || activity.yesterday || "Daily update", date: activity.date, time: activity.time || ["09:00", "09:15", "09:30"][index % 3], minutes: 0, sample: Boolean(activity.sample), source: "Activity log" });
    });
    return logs;
  }
  function workLedgerCutoffDate(retentionMonths, now = /* @__PURE__ */ new Date()) {
    const date = new Date(now);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - retentionMonths);
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, daysInMonth));
    return date.toISOString().slice(0, 10);
  }
  function pruneWorkLedger2(target = store2, now = /* @__PURE__ */ new Date()) {
    const months = Number(target?.settings?.workLedger?.retentionMonths);
    if (!Number.isInteger(months) || months <= 0 || !Array.isArray(target?.workLogs)) return 0;
    const cutoff = workLedgerCutoffDate(months, now);
    const before = target.workLogs.length;
    target.workLogs = target.workLogs.filter((log) => {
      const value = log?.date;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
      const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return true;
      return value >= cutoff;
    });
    return before - target.workLogs.length;
  }
  function logWorkEvent2({ personId = "", actorUserId = "", taskId = "", projectId = "", action, statusFrom = "", statusTo = "", summary = "", minutes = 0 }) {
    store2.workLogs = store2.workLogs || [];
    const now = /* @__PURE__ */ new Date();
    const task = taskId ? store2.tasks.find((row) => String(row.id) === String(taskId)) : null;
    const project = projectId ? store2.projects.find((row) => String(row.id) === String(projectId)) : null;
    const log = {
      id: id2("worklog"),
      personId,
      actorUserId,
      taskId,
      projectId,
      taskTitle: task?.title || "",
      projectName: project?.name || "",
      projectCode: project?.code || "",
      action,
      statusFrom,
      statusTo,
      summary,
      date: todayLA2(now),
      time: timeLA2(now),
      minutes: Math.max(0, parseNumber2(minutes, 0)),
      sample: false
    };
    store2.workLogs.push(log);
    pruneWorkLedger2(store2, now);
    return log;
  }
  function createActivityBlockerAlert2(activity) {
    const reason = String(activity.blocked || "").trim();
    if (!reason) return null;
    store2.alerts = store2.alerts || [];
    const normalizedReason = reason.toLocaleLowerCase();
    const existing = store2.alerts.find((alert2) => alert2.resolved !== true && alert2.source === "activity-blocker" && String(alert2.personId || "") === String(activity.personId) && String(alert2.body || "").trim().toLocaleLowerCase() === normalizedReason);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (existing) {
      existing.lastSeenAt = now;
      existing.occurrences = Math.min(1e6, Number(existing.occurrences || 1) + 1);
      return { alert: existing, created: false };
    }
    const person = store2.people.find((row) => String(row.id) === String(activity.personId));
    const alert = {
      id: id2("alert"),
      title: `Blocker reported by ${person?.name || "workspace member"}`,
      body: reason,
      type: "blocker",
      tone: "orange",
      projectId: "",
      taskId: "",
      personId: activity.personId,
      activityId: activity.id,
      source: "activity-blocker",
      occurrences: 1,
      resolved: false,
      createdAt: todayLA2(),
      lastSeenAt: now,
      customFields: {},
      sample: false
    };
    store2.alerts.push(alert);
    return { alert, created: true };
  }
  function demoStore2() {
    const today = todayLA2();
    const teams = [
      { id: "team-platform", name: "Platform", color: "purple", sample: true },
      { id: "team-product", name: "Product Experience", color: "blue", sample: true },
      { id: "team-growth", name: "Growth", color: "orange", sample: true },
      { id: "team-data", name: "Data", color: "green", sample: true }
    ];
    const people = [
      { id: "p1", name: "Maya Chen", email: "maya@atlas.local", jobTitle: "Engineering Manager", teamId: "team-platform", focus: "Release readiness and cross-team alignment", capacity: 78, status: "On track", color: "purple", sample: true },
      { id: "p2", name: "Noah Reed", email: "noah@atlas.local", jobTitle: "Senior Developer", teamId: "team-platform", focus: "API reliability and observability", capacity: 82, status: "On track", color: "blue", sample: true },
      { id: "p3", name: "Lina Patel", email: "lina@atlas.local", jobTitle: "Product Designer", teamId: "team-product", focus: "Onboarding interaction polish", capacity: 64, status: "On track", color: "pink", sample: true },
      { id: "p4", name: "Omar Haddad", email: "omar@atlas.local", jobTitle: "QA Lead", teamId: "team-product", focus: "Regression gates and risk checks", capacity: 91, status: "Needs attention", color: "orange", sample: true },
      { id: "p5", name: "Ella Brooks", email: "ella@atlas.local", jobTitle: "Data Engineer", teamId: "team-data", focus: "Delivery metrics warehouse", capacity: 70, status: "On track", color: "green", sample: true },
      { id: "p6", name: "Samir Khan", email: "samir@atlas.local", jobTitle: "Growth Engineer", teamId: "team-growth", focus: "Activation experiments", capacity: 58, status: "On track", color: "teal", sample: true }
    ];
    const projects = [
      { id: 1, name: "Atlas Command Center", code: "ATL", description: "Make daily operations visible with decision-ready workspace intelligence.", teamId: "team-platform", ownerId: "p1", color: "purple", status: "On track", deadline: addDays2(today, 19), createdAt: addDays2(today, -70), sample: true },
      { id: 2, name: "Customer Onboarding", code: "ONB", description: "Design a fast, guided path from invited user to productive team member.", teamId: "team-product", ownerId: "p3", color: "blue", status: "At risk", deadline: addDays2(today, 9), createdAt: addDays2(today, -50), sample: true },
      { id: 3, name: "Data Reliability", code: "DR", description: "Harden reporting pipelines and close the trust gap in operational data.", teamId: "team-data", ownerId: "p5", color: "green", status: "On track", deadline: addDays2(today, 37), createdAt: addDays2(today, -44), sample: true },
      { id: 4, name: "Growth Experiments", code: "GRW", description: "Run activation experiments with clear tracking and learning loops.", teamId: "team-growth", ownerId: "p6", color: "orange", status: "On track", deadline: addDays2(today, 31), createdAt: addDays2(today, -30), sample: true }
    ];
    const tasks = [
      { id: 1, title: "Finalize advanced reporting export templates", projectId: 1, assigneeId: "p1", priority: "High", dueDate: today, status: "In progress", type: "Documentation", blocked: false, createdAt: addDays2(today, -7), sample: true },
      { id: 2, title: "Wire native drag-and-drop board updates", projectId: 1, assigneeId: "p2", priority: "High", dueDate: addDays2(today, 1), status: "Review", type: "Development", blocked: false, createdAt: addDays2(today, -9), sample: true },
      { id: 3, title: "QA keyboard shortcut coverage", projectId: 1, assigneeId: "p4", priority: "Medium", dueDate: addDays2(today, 4), status: "Testing", type: "Testing", blocked: false, createdAt: addDays2(today, -11), sample: true },
      { id: 4, title: "Design setup wizard empty states", projectId: 2, assigneeId: "p3", priority: "Medium", dueDate: addDays2(today, 2), status: "Done", type: "Design", blocked: false, createdAt: addDays2(today, -18), completedAt: addDays2(today, -1), sample: true },
      { id: 5, title: "Resolve SSO callback mismatch", projectId: 2, assigneeId: "p2", priority: "High", dueDate: addDays2(today, -1), status: "In progress", type: "Development", blocked: true, createdAt: addDays2(today, -13), sample: true },
      { id: 6, title: "Refresh welcome checklist microcopy", projectId: 2, assigneeId: "p3", priority: "Low", dueDate: addDays2(today, 6), status: "To do", type: "Design", blocked: false, createdAt: addDays2(today, -6), sample: true },
      { id: 7, title: "Backfill delivery metrics for quarterly trend", projectId: 3, assigneeId: "p5", priority: "Medium", dueDate: addDays2(today, 3), status: "In progress", type: "Development", blocked: false, createdAt: addDays2(today, -16), sample: true },
      { id: 8, title: "Add pipeline freshness alert", projectId: 3, assigneeId: "p5", priority: "High", dueDate: addDays2(today, 8), status: "To do", type: "Development", blocked: false, createdAt: addDays2(today, -4), sample: true },
      { id: 9, title: "Prototype activation cohort dashboard", projectId: 4, assigneeId: "p6", priority: "Medium", dueDate: addDays2(today, 10), status: "Review", type: "Development", blocked: false, createdAt: addDays2(today, -8), sample: true },
      { id: 10, title: "Document experiment naming rules", projectId: 4, assigneeId: "p6", priority: "Low", dueDate: addDays2(today, 15), status: "Done", type: "Documentation", blocked: false, createdAt: addDays2(today, -25), completedAt: addDays2(today, -10), sample: true },
      { id: 11, title: "Create annual executive delivery pack", projectId: 1, assigneeId: "p1", priority: "High", dueDate: addDays2(today, 12), status: "To do", type: "Documentation", blocked: false, createdAt: addDays2(today, -2), sample: true },
      { id: 12, title: "Polish local font loading and offline shell", projectId: 1, assigneeId: "p2", priority: "Medium", dueDate: addDays2(today, 5), status: "Done", type: "Development", blocked: false, createdAt: addDays2(today, -14), completedAt: today, sample: true }
    ];
    const oldTasks = [];
    for (let i = 13; i <= 54; i++) {
      const projectId = (i - 1) % 4 + 1;
      const createdAt = addDays2(today, -(i * 5 % 360) - 7);
      const done = i % 3 !== 0;
      oldTasks.push({
        id: i,
        title: `Historical delivery item ${i - 12}`,
        projectId,
        assigneeId: people[(i - 1) % people.length].id,
        priority: ["Low", "Medium", "High"][i % 3],
        dueDate: addDays2(createdAt, 8 + i % 14),
        status: done ? "Done" : ["To do", "In progress", "Review", "Testing"][i % 4],
        type: ["Development", "Design", "Testing", "Documentation"][i % 4],
        blocked: !done && i % 7 === 0,
        createdAt,
        completedAt: done ? addDays2(createdAt, 5 + i % 12) : void 0,
        sample: true
      });
    }
    const milestones = [
      { id: "m1", projectId: 1, name: "Executive report builder", dueDate: addDays2(today, 12), status: "Upcoming", sample: true },
      { id: "m2", projectId: 2, name: "Pilot onboarding release", dueDate: addDays2(today, 9), status: "At risk", sample: true },
      { id: "m3", projectId: 3, name: "Pipeline SLA review", dueDate: addDays2(today, 18), status: "Upcoming", sample: true },
      { id: "m4", projectId: 4, name: "Experiment readout", dueDate: addDays2(today, 22), status: "Upcoming", sample: true }
    ];
    const activities = [
      { id: "a1", personId: "p1", date: today, time: "09:10", yesterday: "Validated report requirements with leadership.", today: "Finalize export templates and print presets.", blocked: "", upcoming: "Annual report review.", status: "Confirmed", sample: true },
      { id: "a2", personId: "p2", date: today, time: "09:20", yesterday: "Completed local asset audit.", today: "Review drag-and-drop persistence and API update paths.", blocked: "SSO callback mismatch needs environment confirmation.", upcoming: "Ship board interaction polish.", status: "Confirmed", sample: true },
      { id: "a3", personId: "p3", date: today, time: "09:31", yesterday: "Finished setup wizard states.", today: "Improve onboarding checklist affordances.", blocked: "", upcoming: "Design review.", status: "Confirmed", sample: true },
      { id: "a4", personId: "p4", date: addDays2(today, -1), time: "16:40", yesterday: "Ran regression smoke test.", today: "Validate keyboard shortcuts and print layouts.", blocked: "", upcoming: "Testing sign-off.", status: "Confirmed", sample: true },
      { id: "a5", personId: "p5", date: addDays2(today, -1), time: "15:25", yesterday: "Backfilled weekly delivery metrics.", today: "Compare monthly and quarterly rollups.", blocked: "", upcoming: "Freshness alert.", status: "Confirmed", sample: true },
      { id: "a6", personId: "p6", date: addDays2(today, -2), time: "14:05", yesterday: "Mapped activation cohorts.", today: "Prototype readout dashboard.", blocked: "", upcoming: "Experiment kickoff.", status: "Confirmed", sample: true }
    ];
    const alerts = [
      { id: "al1", title: "Onboarding release is at risk", body: "SSO callback mismatch blocks the pilot release path.", type: "risk", tone: "orange", projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
      { id: "al2", title: "Overdue task detected", body: "Resolve SSO callback mismatch is past its due date.", type: "overdue", tone: "red", projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
      { id: "al3", title: "Local assets confirmed", body: "Fonts, icons, manifest, and service worker are local to the project.", type: "info", tone: "blue", projectId: 1, resolved: true, createdAt: addDays2(today, -1), sample: true }
    ];
    const allTasks = [...tasks, ...oldTasks];
    const workLogs = buildSeedWorkLogs2(allTasks, activities);
    return {
      meta: newStoreMeta2({ seededAt: (/* @__PURE__ */ new Date()).toISOString() }),
      configured: true,
      counters: { project: 5, task: 55 },
      settings: normalizeSettings2({ ...defaultSettings2(), workspaceName: "Northstar", workspaceUnit: "Engineering", workspace: { ...defaultSettings2().workspace, name: "Northstar", unit: "Engineering" } }),
      users: [
        { id: "u1", name: "Maya Chen", email: "maya@atlas.local", passwordHash: hashPassword2("atlas-demo"), role: "Administrator", personId: "p1", avatarColor: "purple", active: true, sample: true },
        { id: "u2", name: "Noah Reed", email: "manager@atlas.local", passwordHash: hashPassword2("manager-demo"), role: "Manager", personId: "p2", avatarColor: "blue", active: true, sample: true },
        { id: "u3", name: "Lina Patel", email: "developer@atlas.local", passwordHash: hashPassword2("developer-demo"), role: "Developer", personId: "p3", avatarColor: "pink", active: true, sample: true },
        { id: "u4", name: "Omar Haddad", email: "viewer@atlas.local", passwordHash: hashPassword2("viewer-demo"), role: "Viewer", personId: "p4", avatarColor: "orange", active: true, sample: true }
      ],
      teams,
      people,
      projects,
      tasks: allTasks,
      milestones,
      activities,
      alerts,
      workLogs
    };
  }
  function ensureCollection2(storeObject, key) {
    if (!Array.isArray(storeObject[key])) storeObject[key] = [];
  }
  function normalizeStore2(next = {}) {
    if (!isPlainObject2(next)) next = productionStore2();
    const legacyRetentionWasExplicit = isPlainObject2(next.settings?.workLedger) && Object.hasOwn(next.settings.workLedger, "retentionMonths");
    next.settings = normalizeSettings2(next.settings || {});
    if (!legacyRetentionWasExplicit) next.settings.workLedger.retentionMonths = 0;
    const existingMeta = isPlainObject2(next.meta) ? next.meta : {};
    next.meta = newStoreMeta2({
      ...existingMeta,
      createdAt: existingMeta.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      writeCount: Number(existingMeta.writeCount || 0),
      backupRetention: next.settings.storage.backupRetention,
      lastMigrationAt: existingMeta.schemaVersion === STORE_SCHEMA_VERSION2 ? existingMeta.lastMigrationAt : (/* @__PURE__ */ new Date()).toISOString()
    });
    ["users", "teams", "people", "projects", "tasks", "milestones", "activities", "alerts", "workLogs", "auditLogs"].forEach((key) => ensureCollection2(next, key));
    if (existingMeta.schemaVersion !== STORE_SCHEMA_VERSION2) {
      next.workLogs = next.workLogs.filter((log) => !isPlainObject2(log) || !/^wl_(?:seed|activity)_/.test(String(log.id || "")));
    }
    const maxProjectId = next.projects.reduce((maximum, project) => Math.max(maximum, Number(project.id) || 0), 0);
    const maxTaskId = next.tasks.reduce((maximum, task) => Math.max(maximum, Number(task.id) || 0), 0);
    next.counters = {
      project: Math.max(Number(next.counters?.project || 1), maxProjectId + 1),
      task: Math.max(Number(next.counters?.task || 1), maxTaskId + 1)
    };
    if (!next.workLogs.length) {
      const sampleTasks = next.tasks.filter((task) => task.sample === true);
      const sampleActivities = next.activities.filter((activity) => activity.sample === true);
      if (sampleTasks.length || sampleActivities.length) next.workLogs = buildSeedWorkLogs2(sampleTasks, sampleActivities);
    }
    pruneWorkLedger2(next);
    next.users.forEach((user) => {
      user.role = user.role || "Viewer";
      user.active = user.active !== false;
      user.avatarColor = user.avatarColor || next.people.find((person) => person.id === user.personId)?.color || "purple";
      normalizeUserSecrets2(user);
    });
    if (allowDemoData2) {
      const demoUsers = demoStore2().users;
      demoUsers.forEach((sampleUser) => {
        if (!next.users.some((user) => user.email.toLowerCase() === sampleUser.email.toLowerCase()) && next.people.some((person) => person.id === sampleUser.personId)) next.users.push(normalizeUserSecrets2(sampleUser));
      });
    }
    next.configured = typeof next.configured === "boolean" ? next.configured : next.users.length > 0;
    return next;
  }
  function productionStore2() {
    return {
      meta: newStoreMeta2(),
      configured: false,
      counters: { project: 1, task: 1 },
      settings: defaultSettings2(),
      users: [],
      teams: [],
      people: [],
      projects: [],
      tasks: [],
      milestones: [],
      activities: [],
      alerts: [],
      workLogs: [],
      auditLogs: []
    };
  }
  function validateStoreState2(candidate = store2) {
    const errors = [];
    const warnings = [];
    const collections = ["users", "teams", "people", "projects", "tasks", "milestones", "activities", "alerts", "workLogs", "auditLogs"];
    collections.forEach((key) => {
      if (!Array.isArray(candidate?.[key])) errors.push(`${key} must be an array`);
    });
    if (candidate?.meta?.schemaVersion !== STORE_SCHEMA_VERSION2) warnings.push(`Store schema is ${candidate?.meta?.schemaVersion || "missing"}; expected ${STORE_SCHEMA_VERSION2}`);
    if (!candidate?.settings?.workspace || !candidate?.settings?.interface || !candidate?.settings?.localization) errors.push("Settings must include workspace, interface, and localization configuration branches");
    if (!candidate?.settings?.workflows?.task?.states?.length) errors.push("Task workflow must define at least one state");
    if (!candidate?.settings?.permissions?.roles?.Administrator?.permissions?.includes("manageSettings")) errors.push("Administrator role must retain manageSettings permission");
    const duplicateValues = (items, getter, label) => {
      const seen = /* @__PURE__ */ new Set();
      (items || []).forEach((item) => {
        const value = getter(item);
        if (!value) return;
        if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}`);
        seen.add(value);
      });
    };
    duplicateValues(candidate?.users, (user) => String(user.email || "").toLowerCase(), "user email");
    duplicateValues(candidate?.people, (person) => person.id, "person id");
    duplicateValues(candidate?.projects, (project) => String(project.id), "project id");
    duplicateValues(candidate?.tasks, (task) => String(task.id), "task id");
    const people = new Set((candidate?.people || []).map((person) => person.id));
    const teams = new Set((candidate?.teams || []).map((team) => team.id));
    const projects = new Set((candidate?.projects || []).map((project) => String(project.id)));
    const tasks = new Set((candidate?.tasks || []).map((task) => String(task.id)));
    (candidate?.people || []).forEach((person) => {
      if (person.teamId && !teams.has(person.teamId)) warnings.push(`Person ${person.name || person.id} references a missing team`);
    });
    (candidate?.users || []).forEach((user) => {
      if (user.password && !user.passwordHash) errors.push(`User ${user.email || user.id} still has a plain-text password field`);
      if (user.personId && !people.has(user.personId)) warnings.push(`User ${user.email || user.id} references a missing person profile`);
    });
    (candidate?.projects || []).forEach((project) => {
      if (project.teamId && !teams.has(project.teamId)) warnings.push(`Project ${project.name || project.id} references a missing team`);
      if (project.ownerId && !people.has(project.ownerId)) warnings.push(`Project ${project.name || project.id} references a missing owner`);
    });
    (candidate?.tasks || []).forEach((task) => {
      if (!projects.has(String(task.projectId))) warnings.push(`Task ${task.title || task.id} references a missing project`);
      if (task.assigneeId && !people.has(task.assigneeId)) warnings.push(`Task ${task.title || task.id} references a missing assignee`);
    });
    (candidate?.milestones || []).forEach((milestone) => {
      if (milestone.projectId && !projects.has(String(milestone.projectId))) warnings.push(`Milestone ${milestone.name || milestone.id} references a missing project`);
    });
    (candidate?.alerts || []).forEach((alert) => {
      if (alert.projectId && !projects.has(String(alert.projectId))) warnings.push(`Alert ${alert.title || alert.id} references a missing project`);
      if (alert.taskId && !tasks.has(String(alert.taskId))) warnings.push(`Alert ${alert.title || alert.id} references a missing task`);
    });
    return { integrity: errors.length ? "attention" : warnings.length ? "warning" : "ok", errors, warnings };
  }
  function storeChecksum2(candidate = store2) {
    return crypto3.createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
  }
  return { newStoreMeta: newStoreMeta2, buildSeedWorkLogs: buildSeedWorkLogs2, logWorkEvent: logWorkEvent2, pruneWorkLedger: pruneWorkLedger2, createActivityBlockerAlert: createActivityBlockerAlert2, demoStore: demoStore2, ensureCollection: ensureCollection2, normalizeStore: normalizeStore2, productionStore: productionStore2, validateStoreState: validateStoreState2, storeChecksum: storeChecksum2 };
}

// src/server/domain/time.js
function createTimeService({ getStore, environmentTimezone, isValidTimezone: isValidTimezone2 }) {
  function workspaceTimezone() {
    const configured = getStore()?.settings?.workspace?.defaultTimezone || environmentTimezone;
    return isValidTimezone2(configured) ? configured : "America/Los_Angeles";
  }
  function todayLA2(date = /* @__PURE__ */ new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: workspaceTimezone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  function timeLA2(date = /* @__PURE__ */ new Date()) {
    return new Intl.DateTimeFormat("en-US", { timeZone: workspaceTimezone(), hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  return { workspaceTimezone, todayLA: todayLA2, timeLA: timeLA2 };
}
function addDays(value, offset) {
  const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "No date";
  const date = value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? /* @__PURE__ */ new Date(`${value}T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
}
function daysBetween(a, b) {
  return Math.ceil((/* @__PURE__ */ new Date(`${b}T12:00:00Z`) - /* @__PURE__ */ new Date(`${a}T12:00:00Z`)) / 864e5);
}

// src/server/shared/primitives.js
import crypto4 from "node:crypto";
function boundedInteger(value, fallback, min, max) {
  if (value === null || value === void 0 || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}
function id(prefix) {
  return `${prefix}_${crypto4.randomBytes(16).toString("hex")}`;
}
function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /[\s\u0000-\u001f]/.test(email)) return false;
  const parts = email.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[0].length <= 64 && parts[1].includes(".") && !parts[1].startsWith(".") && !parts[1].endsWith(".");
}
function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isValidTimezone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(/* @__PURE__ */ new Date());
    return true;
  } catch {
    return false;
  }
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/server/http/rate-limit.js
function createRateLimitMiddleware({ sendError: sendError2, getClientAddress = defaultClientAddress }) {
  function rateLimit(map, key, limit, windowMs) {
    const now = Date.now();
    const current = map.get(key);
    if (!current || current.resetAt <= now) map.set(key, { count: 1, resetAt: now + windowMs });
    else {
      current.count += 1;
      if (current.count > limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1e3));
    }
    if (map.size > 1e4) {
      for (const [entryKey, entry] of map) if (entry.resetAt <= now) map.delete(entryKey);
    }
    return 0;
  }
  function rateLimitMiddleware2(map, limit, windowMs, keySelector = getClientAddress) {
    return (req, res, next) => {
      const retryAfter = rateLimit(map, keySelector(req), limit, windowMs);
      if (retryAfter) {
        res.setHeader("Retry-After", String(retryAfter));
        return sendError2(res, 429, "Too many requests. Try again later.");
      }
      next();
    };
  }
  return { rateLimit, rateLimitMiddleware: rateLimitMiddleware2, clientAddress: getClientAddress };
}
function defaultClientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 100);
}

// src/server/http/auth-middleware.js
function createAuthMiddleware({ getStore, sessions: sessions2, can: can2, invalidateUserSessions: invalidateUserSessions2, sendError: sendError2 }) {
  function requireUser2(req, res, next) {
    const sid = req.cookies?.atlas_sid;
    const session = sid && sessions2.get(sid);
    if (!session || session.expiresAt <= Date.now()) {
      if (sid) sessions2.delete(sid);
      return sendError2(res, 401, "Sign in to continue");
    }
    const user = getStore()?.users?.find((candidate) => candidate.id === session.userId);
    if (!user) {
      sessions2.delete(sid);
      return sendError2(res, 401, "Sign in to continue");
    }
    if (user.active === false) {
      invalidateUserSessions2(user.id);
      return sendError2(res, 403, "This account is disabled");
    }
    req.user = user;
    next();
  }
  function requirePermission2(permission, message = "You do not have permission to complete this action") {
    return (req, res, next) => {
      if (!can2(req.user, permission)) return sendError2(res, 403, message);
      next();
    };
  }
  function requireManager2(req, res, next) {
    if (!can2(req.user, "manageProjects") && !can2(req.user, "managePeople") && !can2(req.user, "manageAlerts")) return sendError2(res, 403, "Manager or administrator access required");
    next();
  }
  function requireAdmin2(req, res, next) {
    if (req.user?.role !== "Administrator" || !can2(req.user, "manageSettings")) return sendError2(res, 403, "Administrator access required");
    next();
  }
  return { requireUser: requireUser2, requirePermission: requirePermission2, requireManager: requireManager2, requireAdmin: requireAdmin2 };
}

// src/server/domain/workflows.js
function createWorkflowService({ getStore, defaultTaskStates }) {
  function taskWorkflowDefinitions2() {
    const configured = getStore()?.settings?.workflows?.task?.states;
    return Array.isArray(configured) && configured.length ? configured : defaultTaskStates;
  }
  function taskWorkflowStates2() {
    return taskWorkflowDefinitions2().map((state) => state.label || state.name || String(state)).filter(Boolean);
  }
  function terminalTaskStates2() {
    return taskWorkflowDefinitions2().filter((state) => state.terminal).map((state) => state.label || state.name || String(state)).filter(Boolean);
  }
  function isDone2(task) {
    return terminalTaskStates2().includes(task?.status) || task?.status === "Done";
  }
  return { taskWorkflowDefinitions: taskWorkflowDefinitions2, taskWorkflowStates: taskWorkflowStates2, terminalTaskStates: terminalTaskStates2, isDone: isDone2 };
}

// app.tsx
import { AsyncLocalStorage } from "node:async_hooks";

// src/server/domain/offline-sync.js
import crypto5 from "node:crypto";
var ENTITY_FIELDS = Object.freeze({
  tasks: ["title", "projectId", "assigneeId", "priority", "dueDate", "status", "type", "blocked", "tags", "createdAt", "completedAt", "customFields"],
  projects: ["name", "code", "description", "teamId", "ownerId", "color", "status", "deadline", "createdAt", "customFields"],
  people: ["name", "email", "jobTitle", "teamId", "focus", "capacity", "status", "color", "customFields"],
  teams: ["name", "color", "customFields"],
  milestones: ["name", "projectId", "dueDate", "status", "customFields"],
  alerts: ["title", "body", "type", "tone", "projectId", "taskId", "personId", "activityId", "source", "resolved", "createdAt", "lastSeenAt", "customFields"],
  activities: ["personId", "date", "time", "yesterday", "today", "blocked", "upcoming", "status", "customFields"],
  preferences: ["filters"],
  settings: []
});
var CREATE_PATHS = /* @__PURE__ */ new Map([
  ["/api/tasks", "tasks"],
  ["/api/projects", "projects"],
  ["/api/people", "people"],
  ["/api/teams", "teams"],
  ["/api/milestones", "milestones"],
  ["/api/activity", "activities"],
  ["/api/alerts", "alerts"]
]);
var ITEM_PATHS = /* @__PURE__ */ new Map([
  ["tasks", "tasks"],
  ["projects", "projects"],
  ["people", "people"],
  ["teams", "teams"],
  ["milestones", "milestones"],
  ["activity", "activities"],
  ["alerts", "alerts"]
]);
var MISSING = /* @__PURE__ */ Symbol("offline-sync-missing");
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function equal(left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
var REFERENCE_FIELDS = /* @__PURE__ */ new Set(["projectId", "assigneeId", "teamId", "ownerId", "taskId", "personId", "activityId"]);
function fieldEqual(collection, key, left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  if (REFERENCE_FIELDS.has(key) && left !== null && right !== null && left !== "" && right !== "") return String(left) === String(right);
  if (collection === "people" && key === "capacity" && left !== "" && right !== "") return Number(left) === Number(right);
  return equal(left, right);
}
function clone(value) {
  return value === MISSING ? MISSING : structuredClone(value);
}
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function getAtPath(value, path4) {
  let current = value;
  for (const key of path4) {
    if (!isObject(current) || !hasOwn(current, key)) return MISSING;
    current = current[key];
  }
  return current;
}
function setAtPath(target, path4, value) {
  let current = target;
  for (let index = 0; index < path4.length - 1; index++) {
    const key = path4[index];
    if (!isObject(current[key])) current[key] = {};
    current = current[key];
  }
  const last = path4[path4.length - 1];
  if (value === MISSING) delete current[last];
  else current[last] = clone(value);
}
function serializableValue(value) {
  return value === MISSING ? void 0 : clone(value);
}
function changedLeaves(base, local, path4 = []) {
  if (isObject(base) && isObject(local)) {
    const keys = /* @__PURE__ */ new Set([...Object.keys(base), ...Object.keys(local)]);
    return [...keys].flatMap((key) => changedLeaves(hasOwn(base, key) ? base[key] : MISSING, hasOwn(local, key) ? local[key] : MISSING, [...path4, key]));
  }
  return equal(base, local) ? [] : [{ path: path4, base, local }];
}
function entityFields(collection) {
  return ENTITY_FIELDS[collection] || [];
}
function classifySyncRequest(method, pathname) {
  const verb = String(method || "GET").toUpperCase();
  const cleanPath = String(pathname || "").split("?")[0].replace(/\/$/, "") || "/";
  if (verb === "POST") {
    const conflictResolution = cleanPath.match(/^\/api\/offline-sync\/conflicts\/([^/]+)\/resolve$/);
    if (conflictResolution) return { collection: "syncConflicts", action: "resolve", id: decodeURIComponent(conflictResolution[1]) };
  }
  if (verb === "PUT" && cleanPath === "/api/settings") return { collection: "settings", action: "update", id: "workspace" };
  if (verb === "PUT" && cleanPath === "/api/preferences") return { collection: "preferences", action: "update", id: "current-user" };
  if (verb === "POST" && CREATE_PATHS.has(cleanPath)) return { collection: CREATE_PATHS.get(cleanPath), action: "create", id: "" };
  if (verb === "PUT" || verb === "PATCH" || verb === "DELETE") {
    const match = cleanPath.match(/^\/api\/(tasks|projects|people|teams|milestones|activity|alerts)\/([^/]+)(?:\/(status))?$/);
    if (!match) return null;
    const collection = ITEM_PATHS.get(match[1]);
    const isTaskStatus = match[1] === "tasks" && match[3] === "status";
    if (match[3] && !isTaskStatus) return null;
    if (isTaskStatus && verb !== "PATCH") return null;
    if (verb === "PATCH" && !(isTaskStatus || match[1] === "alerts")) return null;
    if (verb === "PUT" && match[1] === "alerts") return null;
    return { collection, action: verb === "DELETE" ? "delete" : "update", id: decodeURIComponent(match[2]), statusOnly: isTaskStatus };
  }
  return null;
}
function canonicalSyncRecord(collection, record) {
  if (!record) return null;
  if (collection === "settings") return clone(record);
  const result = {};
  for (const key of entityFields(collection)) {
    if (hasOwn(record, key)) result[key] = clone(record[key]);
  }
  if (collection === "tasks") {
    result.createdAt = result.createdAt || "";
    result.completedAt = result.completedAt || "";
  }
  if (collection === "projects") {
    if (!hasOwn(result, "deadline") && hasOwn(record, "deadlineDate")) result.deadline = record.deadlineDate;
    result.deadline = result.deadline || "";
    result.createdAt = result.createdAt || "";
  }
  if (collection === "alerts") {
    for (const key of ["personId", "activityId", "source", "lastSeenAt"]) result[key] = result[key] || "";
  }
  if (Object.hasOwn(result, "customFields")) result.customFields = result.customFields || {};
  return result;
}
function compareOfflineRecords(collection, baseRecord, currentRecord) {
  if (!isObject(baseRecord) || !isObject(currentRecord)) return [{ path: "*", base: baseRecord ?? null, server: currentRecord ?? null }];
  const differences = [];
  for (const key of entityFields(collection)) {
    if (key === "customFields") continue;
    const baseValue = hasOwn(baseRecord, key) ? baseRecord[key] : MISSING;
    const serverValue = hasOwn(currentRecord, key) ? currentRecord[key] : MISSING;
    if (!fieldEqual(collection, key, baseValue, serverValue)) differences.push({
      path: key,
      base: serializableValue(baseValue),
      server: serializableValue(serverValue),
      baseExists: baseValue !== MISSING,
      serverExists: serverValue !== MISSING
    });
  }
  const baseFields = isObject(baseRecord.customFields) ? baseRecord.customFields : {};
  const serverFields = isObject(currentRecord.customFields) ? currentRecord.customFields : {};
  for (const change of changedLeaves(baseFields, serverFields)) differences.push({
    path: `customFields.${change.path.join(".")}`,
    base: serializableValue(change.base),
    server: serializableValue(change.local),
    baseExists: change.base !== MISSING,
    serverExists: change.local !== MISSING
  });
  return differences;
}
function mergeOfflineRecord({ collection, baseRecord, currentRecord, localBody, statusOnly = false }) {
  if (!isObject(baseRecord) || !isObject(currentRecord) || !isObject(localBody)) {
    return { ok: false, fields: [{ path: "*", base: baseRecord ?? null, local: localBody ?? null, server: currentRecord ?? null }], mergedBody: null };
  }
  const mergedBody = clone(localBody);
  const conflicts = [];
  const allowed = new Set(entityFields(collection));
  const fields = Object.keys(localBody).filter((key) => allowed.has(key) && (!statusOnly || key === "status"));
  for (const key of fields) {
    if (key === "customFields") {
      const baseFields = isObject(baseRecord.customFields) ? baseRecord.customFields : {};
      const localFields = isObject(localBody.customFields) ? localBody.customFields : {};
      const serverFields = isObject(currentRecord.customFields) ? currentRecord.customFields : {};
      const mergedFields = clone(serverFields);
      for (const leaf of changedLeaves(baseFields, localFields)) {
        const serverValue2 = getAtPath(serverFields, leaf.path);
        const pathName = `customFields.${leaf.path.join(".")}`;
        if (equal(serverValue2, leaf.base) || equal(serverValue2, leaf.local)) {
          setAtPath(mergedFields, leaf.path, leaf.local);
          continue;
        }
        conflicts.push({
          path: pathName,
          base: serializableValue(leaf.base),
          local: serializableValue(leaf.local),
          server: serializableValue(serverValue2),
          baseExists: leaf.base !== MISSING,
          localExists: leaf.local !== MISSING,
          serverExists: serverValue2 !== MISSING
        });
      }
      mergedBody.customFields = mergedFields;
      continue;
    }
    const baseValue = hasOwn(baseRecord, key) ? baseRecord[key] : MISSING;
    const localValue = hasOwn(localBody, key) ? localBody[key] : MISSING;
    const serverValue = hasOwn(currentRecord, key) ? currentRecord[key] : MISSING;
    if (fieldEqual(collection, key, localValue, baseValue)) {
      if (serverValue === MISSING) delete mergedBody[key];
      else mergedBody[key] = clone(serverValue);
      continue;
    }
    if (fieldEqual(collection, key, serverValue, baseValue) || fieldEqual(collection, key, serverValue, localValue)) continue;
    conflicts.push({
      path: key,
      base: serializableValue(baseValue),
      local: serializableValue(localValue),
      server: serializableValue(serverValue),
      baseExists: baseValue !== MISSING,
      localExists: localValue !== MISSING,
      serverExists: serverValue !== MISSING
    });
  }
  return { ok: conflicts.length === 0, fields: conflicts, mergedBody: conflicts.length ? null : mergedBody };
}
function findRecord(store2, collection, entityId) {
  return store2?.[collection]?.find((record) => String(record.id) === String(entityId)) || null;
}
function syncRequestHash({ method, pathname, body, localId, baseRecord }) {
  const value = JSON.stringify(canonical({ method: String(method).toUpperCase(), pathname, body: body || {}, localId: localId ?? null, baseRecord: baseRecord ?? null }));
  return crypto5.createHash("sha256").update(value).digest("hex");
}
function currentEntityState(store2, request) {
  return canonicalSyncRecord(request.collection, request.record);
}
function mergeSettingsPath(base, current, local, path4, conflicts) {
  const canRecurse = isObject(local) && (isObject(base) || base === MISSING) && (isObject(current) || current === MISSING);
  if (canRecurse) {
    const baseObject = isObject(base) ? base : {};
    const currentObject = isObject(current) ? current : {};
    const merged = {};
    for (const key of Object.keys(local)) {
      const baseValue2 = hasOwn(baseObject, key) ? baseObject[key] : MISSING;
      const currentValue2 = hasOwn(currentObject, key) ? currentObject[key] : MISSING;
      const value = mergeSettingsPath(baseValue2, currentValue2, local[key], [...path4, key], conflicts);
      if (value !== MISSING) merged[key] = value;
    }
    return merged;
  }
  const baseValue = base;
  const currentValue = current;
  const localValue = local;
  if (equal(localValue, baseValue)) return clone(currentValue);
  if (equal(currentValue, baseValue) || equal(currentValue, localValue)) return clone(localValue);
  conflicts.push({
    path: path4.join("."),
    base: serializableValue(baseValue),
    local: serializableValue(localValue),
    server: serializableValue(currentValue),
    baseExists: baseValue !== MISSING,
    localExists: localValue !== MISSING,
    serverExists: currentValue !== MISSING
  });
  return clone(localValue);
}
function mergeOfflineSettings(baseRecord, currentRecord, localBody) {
  if (!isObject(baseRecord) || !isObject(currentRecord) || !isObject(localBody)) {
    return { ok: false, fields: [{ path: "*", base: baseRecord ?? null, local: localBody ?? null, server: currentRecord ?? null }], mergedBody: null };
  }
  const conflicts = [];
  const mergedBody = mergeSettingsPath(baseRecord, currentRecord, localBody, [], conflicts);
  return { ok: conflicts.length === 0, fields: conflicts, mergedBody: conflicts.length ? null : mergedBody };
}
function hasPermission(can2, actor, permission) {
  return typeof can2 === "function" && can2(actor, permission);
}
function maySynchronize(classification, actor, store2, body, can2, storeRepository2) {
  if (classification.collection === "syncConflicts") {
    const conflict = storeRepository2?.getSyncConflict(classification.id);
    return Boolean(conflict && conflict.actorId === String(actor.id));
  }
  const ownsTask = (taskId) => {
    const task = findRecord(store2, "tasks", taskId);
    return Boolean(task && String(task.assigneeId || "") === String(actor.personId || ""));
  };
  if (classification.collection === "preferences") return true;
  if (classification.collection === "settings") return actor.role === "Administrator" && hasPermission(can2, actor, "manageSettings");
  if (classification.collection === "tasks") {
    if (classification.statusOnly && hasPermission(can2, actor, "writeTasks")) return hasPermission(can2, actor, "manageTasks") || ownsTask(classification.id);
    return hasPermission(can2, actor, "manageTasks");
  }
  if (classification.collection === "projects" || classification.collection === "milestones") return hasPermission(can2, actor, "manageProjects");
  if (classification.collection === "people" || classification.collection === "teams") return hasPermission(can2, actor, "managePeople");
  if (classification.collection === "activities") {
    if (classification.action === "create") return hasPermission(can2, actor, "logActivity");
    if (classification.action === "delete") {
      const activity2 = findRecord(store2, "activities", classification.id);
      const isAdministrator2 = actor.role === "Administrator" && hasPermission(can2, actor, "manageSettings");
      return Boolean(activity2 && (isAdministrator2 || hasPermission(can2, actor, "manageTasks") && String(activity2.personId || "") === String(actor.personId || "")));
    }
    const activity = findRecord(store2, "activities", classification.id);
    const isAdministrator = actor.role === "Administrator" && hasPermission(can2, actor, "manageSettings");
    return Boolean(activity && (isAdministrator || hasPermission(can2, actor, "logActivity") && String(activity.personId || "") === String(actor.personId || "")));
  }
  if (classification.collection === "alerts") {
    if (classification.action === "create" || classification.action === "delete") return hasPermission(can2, actor, "manageAlerts");
    const edits = Object.keys(body || {}).filter((key) => key !== "resolved");
    if (edits.length) return hasPermission(can2, actor, "manageAlerts");
    if (hasPermission(can2, actor, "manageAlerts")) return true;
    const alert = findRecord(store2, "alerts", classification.id);
    return hasPermission(can2, actor, "writeTasks") && Boolean(alert?.taskId) && ownsTask(alert.taskId);
  }
  return false;
}
function createOfflineSyncMiddleware({ getStore, sessions: sessions2, storeRepository: storeRepository2, operationContext, sendError: sendError2, can: can2 }) {
  return function offlineSyncMiddleware(req, res, next) {
    const metadata = req.atlasSync;
    if (!metadata) return next();
    const pathname = String(req.originalUrl || req.path).split("?")[0];
    const classification = classifySyncRequest(req.method, pathname);
    if (!classification) return sendError2(res, 400, "This operation cannot be queued for offline synchronization");
    if (!isObject(metadata) || typeof metadata.operationId !== "string" || !/^[a-zA-Z0-9_-]{16,120}$/.test(metadata.operationId)) return sendError2(res, 400, "Offline operation identifier is invalid");
    if (metadata.collection !== void 0 && metadata.collection !== classification.collection) return sendError2(res, 400, "Offline operation type does not match the API route");
    const sid = req.cookies?.atlas_sid;
    const session = sid && sessions2.get(sid);
    if (!session || session.expiresAt <= Date.now()) return sendError2(res, 401, "Sign in to synchronize pending changes");
    const store2 = getStore();
    const actor = store2?.users?.find((user) => user.id === session.userId && user.active !== false);
    if (!actor) return sendError2(res, 401, "Sign in to synchronize pending changes");
    req.user = actor;
    const cleanBody = req.body || {};
    if (!maySynchronize(classification, actor, store2, cleanBody, can2, storeRepository2)) return sendError2(res, 403, "Your current role is not allowed to synchronize this change");
    const sendConflict = (payload) => {
      try {
        storeRepository2.recordSyncConflict({
          operationId: metadata.operationId,
          actorId: actor.id,
          collection: classification.collection,
          entityId: payload.entityId ?? classification.id ?? null,
          method: req.method,
          path: pathname,
          code: payload.code || "field-conflict",
          baseRecord: payload.baseRecord,
          localRecord: payload.localRecord,
          serverRecord: payload.serverRecord,
          fields: payload.fields || []
        });
        storeRepository2.pruneSyncConflicts(store2?.settings?.audit?.retentionDays);
      } catch (error) {
        console.error("Unable to preserve Atlas offline conflict:", error);
        return sendError2(res, 500, "Unable to safely record this offline conflict");
      }
      return res.status(409).json(payload);
    };
    const localId = metadata.localId;
    if (classification.action === "create" && (typeof localId !== "string" || !/^offline-[a-zA-Z0-9_-]{16,120}$/.test(localId))) {
      return sendError2(res, 400, "Offline record ID is invalid");
    }
    const requestHash = syncRequestHash({ method: req.method, pathname, body: cleanBody, localId, baseRecord: metadata.baseRecord });
    const existingReceipt = storeRepository2.getSyncOperation(metadata.operationId);
    if (existingReceipt) {
      if (existingReceipt.actorId !== actor.id || existingReceipt.requestHash !== requestHash) return sendError2(res, 409, "This offline operation ID was already used for a different request");
      res.setHeader("X-Atlas-Sync-Replayed", "true");
      if (existingReceipt.responseStatus !== null && existingReceipt.responseBody !== null) return res.status(existingReceipt.responseStatus).json(existingReceipt.responseBody);
      return res.status(200).json({ ok: true, applied: true, acknowledgementRecovered: true, operationId: metadata.operationId });
    }
    let directResponse = null;
    if (classification.collection === "syncConflicts") {
      const action = String(cleanBody.action || "");
      const allowedActions = /* @__PURE__ */ new Set(["keep-server", "discard", "new-id", "overwrite", "delete-anyway", "recreate", "merge"]);
      if (!allowedActions.has(action)) return sendError2(res, 400, "Conflict resolution action is invalid");
      const conflict = storeRepository2.getSyncConflict(classification.id);
      if (!conflict) return sendError2(res, 404, "Offline conflict was not found");
      const fieldChoices = cleanBody.fields || {};
      if (!isObject(fieldChoices) || Object.entries(fieldChoices).some(([field3, choice]) => !conflict.fields.some((item) => item.path === field3) || !["local", "server"].includes(choice))) {
        return sendError2(res, 400, "Conflict field selection is invalid");
      }
      const updated = storeRepository2.resolveSyncConflict(classification.id, actor.id, { action, fields: fieldChoices });
      if (!updated) return sendError2(res, 404, "Offline conflict was not found");
      storeRepository2.pruneSyncConflicts(store2?.settings?.audit?.retentionDays);
      directResponse = { ok: true, conflictOperationId: classification.id, status: updated.status };
    } else if (classification.action === "create") {
      if (findRecord(store2, classification.collection, localId)) {
        return sendConflict({
          error: "A record with this offline identifier already exists",
          conflict: true,
          code: "offline-id-collision",
          operationId: metadata.operationId,
          collection: classification.collection,
          localRecord: cleanBody,
          serverRecord: canonicalSyncRecord(classification.collection, findRecord(store2, classification.collection, localId))
        });
      }
    } else if (classification.collection === "settings" && classification.action === "update") {
      if (metadata.enforceConflicts !== false) {
        const merged = mergeOfflineSettings(metadata.baseRecord, store2.settings, cleanBody);
        if (!merged.ok) {
          return sendConflict({
            error: "Some settings changed on the server while this device was offline",
            conflict: true,
            code: "field-conflict",
            operationId: metadata.operationId,
            collection: "settings",
            entityId: "workspace",
            baseRecord: metadata.baseRecord || null,
            localRecord: cleanBody,
            serverRecord: clone(store2.settings),
            fields: merged.fields
          });
        }
        req.body = merged.mergedBody;
      }
    } else if ((classification.action === "update" || classification.action === "delete") && !["preferences", "settings"].includes(classification.collection)) {
      const record = findRecord(store2, classification.collection, classification.id);
      if (metadata.enforceConflicts !== false) {
        if (!record) {
          return sendConflict({
            error: "The record was deleted on the server while this device was offline",
            conflict: true,
            code: "remote-delete",
            operationId: metadata.operationId,
            collection: classification.collection,
            entityId: classification.id,
            baseRecord: metadata.baseRecord || null,
            localRecord: cleanBody,
            serverRecord: null,
            remoteDeleted: true
          });
        }
        const base = metadata.baseRecord;
        const serverRecord = currentEntityState(store2, { collection: classification.collection, record });
        if (classification.action === "delete") {
          const differences = compareOfflineRecords(classification.collection, base, serverRecord);
          if (differences.length) {
            return sendConflict({
              error: "The record changed on the server while this device was offline",
              conflict: true,
              code: "delete-versus-edit",
              operationId: metadata.operationId,
              collection: classification.collection,
              entityId: classification.id,
              baseRecord: base || null,
              localRecord: null,
              serverRecord,
              fields: differences,
              localDelete: true
            });
          }
        } else {
          const merged = mergeOfflineRecord({
            collection: classification.collection,
            baseRecord: base,
            currentRecord: serverRecord,
            localBody: cleanBody,
            statusOnly: classification.statusOnly
          });
          if (!merged.ok) {
            return sendConflict({
              error: "Some fields changed on the server while this device was offline",
              conflict: true,
              code: "field-conflict",
              operationId: metadata.operationId,
              collection: classification.collection,
              entityId: classification.id,
              baseRecord: base || null,
              localRecord: cleanBody,
              serverRecord,
              fields: merged.fields
            });
          }
          req.body = merged.mergedBody;
        }
      }
    }
    metadata.actorId = actor.id;
    metadata.requestHash = requestHash;
    metadata.operationId = metadata.operationId;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          storeRepository2.completeSyncOperation(metadata, res.statusCode, body);
        } catch (error) {
          console.error("Unable to save Atlas sync acknowledgement:", error);
        }
      }
      return originalJson(body);
    };
    if (directResponse) return res.status(200).json(directResponse);
    return operationContext.run(metadata, next);
  };
}
function offlineCreateId(req, collection, factory) {
  if (typeof factory !== "function") throw new TypeError("An ID factory is required");
  const metadata = req?.atlasSync;
  if (!metadata || metadata.collection && metadata.collection !== collection || !metadata.localId) return factory();
  return clone(metadata.localId);
}

// app.tsx
var root = process.env.ATLAS_ROOT || process.cwd();
var dataDir = process.env.ATLAS_DATA_DIR || path3.join(root, "data");
var staticDir = process.env.ATLAS_STATIC_DIR || path3.join(root, "dist");
var databaseFile = process.env.ATLAS_DB_PATH || path3.join(dataDir, "atlas.sqlite");
var legacyDataFile = path3.join(dataDir, "atlas-store.json");
var store = null;
var loginRateLimits = /* @__PURE__ */ new Map();
var offlineSyncContext = new AsyncLocalStorage();
var setupRateLimits = /* @__PURE__ */ new Map();
var i18nRateLimits = /* @__PURE__ */ new Map();
var isProduction = process.env.NODE_ENV === "production";
var allowDemoData = process.env.ATLAS_ALLOW_DEMO_DATA === "true";
var cookieSecure = process.env.ATLAS_COOKIE_SECURE === "true";
var STORE_SCHEMA_VERSION = "4.0.0";
var DATABASE_MODEL = "sqlite-relational";
var DESIGN_SYSTEM_VERSION = "2.0.0";
var DEFAULT_BACKUP_RETENTION = boundedInteger(process.env.ATLAS_BACKUP_RETENTION, 25, 3, 100);
var MIN_PASSWORD_LENGTH = 8;
var MAX_PASSWORD_LENGTH = 1024;
var SESSION_TOKEN_BYTES = 32;
var I18N_MISSING_LIMIT = 2e3;
var MAX_I18N_KEY_LENGTH = 200;
var securityServices = createSecurityService({ getStore: () => store, boundedInteger, cookieSecure, minPasswordLength: MIN_PASSWORD_LENGTH, maxPasswordLength: MAX_PASSWORD_LENGTH, sessionTokenBytes: SESSION_TOKEN_BYTES });
var { sessions, configuredPasswordMinLength, sessionCookieOptions, newSession, invalidateUserSessions, hashPassword, verifyPassword, normalizeUserSecrets, validatePassword, permissionsFor, can, roleRank } = securityServices;
function configuredBackupRetention() {
  return boundedInteger(typeof store !== "undefined" ? store?.settings?.storage?.backupRetention : null, DEFAULT_BACKUP_RETENTION, 3, 100);
}
function ensureDir() {
  fs3.mkdirSync(dataDir, { recursive: true });
}
var timeService = createTimeService({ getStore: () => store, environmentTimezone: process.env.ATLAS_TIMEZONE, isValidTimezone });
var { todayLA, timeLA } = timeService;
var settingsService = createSettingsService({ ROLE_PERMISSIONS, boundedInteger, isPlainObject, isValidTimezone, id, env: process.env, DATABASE_MODEL, STORE_SCHEMA_VERSION, I18N_MISSING_LIMIT, DEFAULT_BACKUP_RETENTION, MIN_PASSWORD_LENGTH, cookieSecure, allowDemoData });
var { DEFAULT_NAVIGATION: DEFAULT_NAVIGATION2, DEFAULT_WORKFLOW_STATES: DEFAULT_WORKFLOW_STATES2, DEFAULT_TRANSLATIONS: DEFAULT_TRANSLATIONS2, ROLE_DESCRIPTIONS: ROLE_DESCRIPTIONS2, roleRegistryDefaults, defaultSettings, mergeDeep, withLegacySettings, normalizeSettings, settingsInputError, slugifyState } = settingsService;
var workflowService = createWorkflowService({ getStore: () => store, defaultTaskStates: DEFAULT_WORKFLOW_STATES2 });
var { taskWorkflowDefinitions, taskWorkflowStates, terminalTaskStates, isDone } = workflowService;
var storeServices = createStoreService({ getStore: () => store, todayLA, timeLA, addDays, id, parseNumber, isPlainObject, defaultSettings, normalizeSettings, hashPassword, normalizeUserSecrets, allowDemoData, STORE_SCHEMA_VERSION, DATABASE_MODEL, DESIGN_SYSTEM_VERSION, configuredBackupRetention });
var { newStoreMeta, buildSeedWorkLogs, logWorkEvent, pruneWorkLedger, createActivityBlockerAlert, demoStore, ensureCollection, normalizeStore, productionStore, validateStoreState, storeChecksum } = storeServices;
var databaseExistedBeforeStartup = fs3.existsSync(databaseFile);
ensureDir();
var sqliteDatabase = openSqliteDatabase(databaseFile, { dataDirectory: dataDir });
var storeRepository = new SqliteStoreRepository(sqliteDatabase, {
  filePath: databaseFile,
  dataDirectory: dataDir,
  backupRetention: DEFAULT_BACKUP_RETENTION
});
var userPreferencesRepository = new UserPreferencesRepository(sqliteDatabase);
function listBackups() {
  return storeRepository.listBackups();
}
function createBackup(reason = "manual") {
  if (!storeRepository.hasSnapshot()) return null;
  return storeRepository.createBackup(reason);
}
function saveStore(next, options = {}) {
  ensureDir();
  const normalized = normalizeStore(next);
  normalized.meta.writeCount = Number(normalized.meta.writeCount || 0) + (options.incrementWriteCount === false ? 0 : 1);
  normalized.meta.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  storeRepository.writeSnapshot(normalized, {
    backup: options.backup === true && storeRepository.hasSnapshot(),
    backupReason: options.reason || "write",
    syncOperation: options.syncOperation || null
  });
  return normalized;
}
function archiveLegacyStore() {
  const legacyDirectory = path3.join(dataDir, "legacy");
  fs3.mkdirSync(legacyDirectory, { recursive: true });
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const archivedPath = path3.join(legacyDirectory, `atlas-store-imported-${timestamp}.json`);
  try {
    fs3.renameSync(legacyDataFile, archivedPath);
    return archivedPath;
  } catch (error) {
    console.warn(`SQLite migration succeeded, but the legacy JSON file could not be archived: ${error.message}`);
    return legacyDataFile;
  }
}
function loadStore() {
  if (storeRepository.hasSnapshot()) {
    const normalized = normalizeStore(storeRepository.loadSnapshot());
    return saveStore(normalized, { incrementWriteCount: false });
  }
  if (fs3.existsSync(legacyDataFile)) {
    let parsed;
    try {
      parsed = JSON.parse(fs3.readFileSync(legacyDataFile, "utf8"));
    } catch (error) {
      const corruptFile = path3.join(dataDir, `atlas-store-corrupt-${Date.now()}.json`);
      fs3.renameSync(legacyDataFile, corruptFile);
      console.error(`Legacy JSON store could not be parsed. Moved it to ${corruptFile}`);
      return saveStore(productionStore(), { incrementWriteCount: false });
    }
    const migrated = saveStore(normalizeStore(parsed), { incrementWriteCount: false });
    console.log(`Imported legacy JSON store into SQLite and archived the source at ${archiveLegacyStore()}`);
    return migrated;
  }
  return saveStore(productionStore(), { incrementWriteCount: false });
}
if (process.argv.includes("--reset-data")) {
  if (!allowDemoData) {
    console.error("Refusing to install demo accounts/data. Set ATLAS_ALLOW_DEMO_DATA=true to enable this development-only reset.");
    sqliteDatabase.close();
    process.exit(1);
  }
  if (fs3.existsSync(legacyDataFile)) archiveLegacyStore();
  saveStore(demoStore(), { backup: storeRepository.hasSnapshot(), reason: "reset-data" });
  console.log(`Reset ${databaseFile} with development demo data`);
  sqliteDatabase.close();
  process.exit(0);
}
if (process.argv.includes("--init-production")) {
  const existingStore = databaseExistedBeforeStartup || storeRepository.hasSnapshot() || fs3.existsSync(legacyDataFile);
  if (existingStore && process.env.ATLAS_FORCE_INIT_PRODUCTION !== "true") {
    console.error(`Refusing to replace existing data at ${databaseFile}. Back it up and set ATLAS_FORCE_INIT_PRODUCTION=true only if a destructive reset is intended.`);
    sqliteDatabase.close();
    process.exit(1);
  }
  if (fs3.existsSync(legacyDataFile)) archiveLegacyStore();
  saveStore(productionStore(), { backup: storeRepository.hasSnapshot(), reason: "init-production" });
  console.log(`Initialized ${databaseFile} for production first-run setup`);
  sqliteDatabase.close();
  process.exit(0);
}
if (process.argv.includes("--backup-data")) {
  if (!storeRepository.hasSnapshot() && fs3.existsSync(legacyDataFile)) loadStore();
  const backup = createBackup("manual");
  console.log(backup ? `Created backup ${backup}` : `No SQLite store found at ${databaseFile}`);
  sqliteDatabase.close();
  process.exit(0);
}
store = loadStore();
var lastCommittedStore = structuredClone(store);
function persist(options = {}) {
  try {
    store = saveStore(store, {
      backup: process.env.ATLAS_BACKUP_ON_WRITE === "true",
      reason: options.reason || "persist",
      syncOperation: offlineSyncContext.getStore() || null
    });
    lastCommittedStore = structuredClone(store);
  } catch (error) {
    try {
      const committedSnapshot = storeRepository.loadSnapshot();
      store = committedSnapshot ? normalizeStore(committedSnapshot) : structuredClone(lastCommittedStore);
    } catch (restoreError) {
      store = structuredClone(lastCommittedStore);
      error.restoreError = restoreError;
    }
    throw error;
  }
}
function auditLog(action, actorId = "", detail = {}) {
  const audit = store?.settings?.audit || {};
  if (audit.enabled === false) return;
  if (action.startsWith("export.") && audit.trackExports === false) return;
  if (action.startsWith("read.") && audit.trackReads !== true) return;
  if (!action.startsWith("auth.") && !action.startsWith("read.") && !action.startsWith("export.") && audit.trackWrites === false) return;
  store.auditLogs = store.auditLogs || [];
  store.auditLogs.push({ id: id("audit"), action, actorId, detail, createdAt: (/* @__PURE__ */ new Date()).toISOString(), source: "api" });
  const retentionDays = boundedInteger(audit.retentionDays, 365, 1, 3650);
  const cutoff = Date.now() - retentionDays * 864e5;
  store.auditLogs = store.auditLogs.filter((event) => !event.createdAt || Date.parse(event.createdAt) >= cutoff);
}
function auditRead(action, userId) {
  if (store?.settings?.audit?.enabled === false || store?.settings?.audit?.trackReads !== true) return;
  auditLog(`read.${action}`, userId, {});
  persist({ reason: "audit-read" });
}
var workspaceServices = createWorkspaceServices({ getStore: () => store, todayLA, addDays, fmt: formatDate, daysBetween, isPlainObject, validIsoDate, permissionsFor, can, isDone, terminalTaskStates });
var { teamById, personById, projectById, taskById, validText, validEmail, validDateValue, validOptionalDate, validCustomFields, customFieldInputError, personReferenceExists, teamReferenceExists, projectReferenceExists, taskReferenceExists, publicUser, publicAccessUser, dueTone, dueLabel, projectProgress, projectHealth, taskPublic, projectPublic, personPublic, activityPublic, alertPublic, bucketFor, makeBuckets, reportFor, dashboard, settingsForUser, bootstrapFor, workLogPublic, bucketLabel, isCompletionEvent, completedTaskIds, activityReportFor, nextProjectId, nextTaskId } = workspaceServices;
function createDatabaseExportContext() {
  const snapshot = storeRepository.loadSnapshot();
  if (!snapshot) throw new Error("SQLite workspace is not initialized");
  const getSnapshot = () => snapshot;
  const databaseTime = createTimeService({ getStore: getSnapshot, environmentTimezone: process.env.ATLAS_TIMEZONE, isValidTimezone });
  const databaseWorkflow = createWorkflowService({ getStore: getSnapshot, defaultTaskStates: DEFAULT_WORKFLOW_STATES2 });
  const workspace = createWorkspaceServices({
    getStore: getSnapshot,
    todayLA: databaseTime.todayLA,
    addDays,
    fmt: formatDate,
    daysBetween,
    isPlainObject,
    validIsoDate,
    permissionsFor,
    can,
    isDone: databaseWorkflow.isDone,
    terminalTaskStates: databaseWorkflow.terminalTaskStates
  });
  return { snapshot, workspace, today: databaseTime.todayLA() };
}
function sendError(res, status, error) {
  res.status(status).json({ error });
}
var { rateLimitMiddleware } = createRateLimitMiddleware({ sendError });
var authMiddleware = createAuthMiddleware({ getStore: () => store, sessions, can, invalidateUserSessions, sendError });
var { requireUser, requirePermission, requireManager, requireAdmin } = authMiddleware;
var app = express();
app.set("trust proxy", boundedInteger(process.env.ATLAS_TRUST_PROXY_HOPS, 0, 0, 5));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'");
  }
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const origin = req.headers.origin;
  if (mutating && req.path.startsWith("/api/") && origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== String(req.headers.host || "").toLowerCase()) return sendError(res, 403, "Cross-origin mutation is not allowed");
    } catch {
      return sendError(res, 403, "Invalid request origin");
    }
  }
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: "16mb" }));
app.use("/api", (req, res, next) => {
  if (req.body !== void 0 && !isPlainObject(req.body)) return sendError(res, 400, "Request body must be a JSON object");
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body === void 0) return sendError(res, 400, "A JSON object request body is required");
  if (req.body && Object.hasOwn(req.body, "__atlasSync")) {
    if (!isPlainObject(req.body.__atlasSync)) return sendError(res, 400, "Offline sync metadata must be an object");
    const { __atlasSync, ...body } = req.body;
    req.atlasSync = __atlasSync;
    req.body = body;
  }
  next();
});
var storeView = new Proxy(/* @__PURE__ */ Object.create(null), {
  get(_target, property) {
    return store == null ? void 0 : Reflect.get(store, property);
  },
  set(_target, property, value) {
    if (store == null) throw new Error("Workspace state is not initialized");
    return Reflect.set(store, property, value);
  },
  has(_target, property) {
    return store != null && Reflect.has(store, property);
  },
  ownKeys() {
    return store == null ? [] : Reflect.ownKeys(store);
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = store == null ? void 0 : Reflect.getOwnPropertyDescriptor(store, property);
    return descriptor ? { ...descriptor, configurable: true } : void 0;
  }
});
var routeServices = {
  store: storeView,
  getStore: () => store,
  setStore: (nextStore) => {
    store = nextStore;
  },
  root,
  databaseFile,
  DATABASE_MODEL,
  STORE_SCHEMA_VERSION,
  DESIGN_SYSTEM_VERSION,
  configuredBackupRetention,
  allowDemoData,
  rateLimitMiddleware,
  setupRateLimits,
  loginRateLimits,
  i18nRateLimits,
  sendError,
  normalizeEmail,
  isValidEmail,
  validatePassword,
  configuredPasswordMinLength,
  settingsInputError,
  mergeDeep,
  defaultSettings,
  normalizeSettings,
  hashPassword,
  todayLA,
  timeLA,
  publicUser,
  newSession,
  sessionCookieOptions,
  auditLog,
  persist,
  can,
  storeRepository,
  userPreferencesRepository,
  listBackups,
  auditRead,
  storeChecksum,
  createDatabaseExportContext,
  validateStoreState,
  requireUser,
  requireAdmin,
  requirePermission,
  createBackup,
  roleRank,
  publicAccessUser,
  verifyPassword,
  invalidateUserSessions,
  sessions,
  normalizeUserSecrets,
  projectById,
  validText,
  MAX_PASSWORD_LENGTH,
  activityReportFor,
  reportFor,
  bootstrapFor,
  settingsForUser,
  demoStore,
  id,
  MAX_I18N_KEY_LENGTH,
  I18N_MISSING_LIMIT,
  isPlainObject,
  path: path3,
  validOptionalDate,
  personReferenceExists,
  customFieldInputError,
  nextProjectId,
  nextTaskId,
  taskPublic,
  projectPublic,
  taskById,
  taskWorkflowStates,
  pruneWorkLedger,
  terminalTaskStates,
  isDone,
  logWorkEvent,
  taskReferenceExists,
  validDateValue,
  dueTone,
  validEmail,
  teamReferenceExists,
  projectReferenceExists,
  personById,
  personPublic,
  activityPublic,
  alertPublic,
  createActivityBlockerAlert,
  requireManager,
  teamById,
  offlineCreateId
};
app.use("/api", createOfflineSyncMiddleware({ getStore: () => store, sessions, storeRepository, operationContext: offlineSyncContext, sendError, can }));
registerRoutes(app, routeServices);
app.use((error, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(error);
  if (res.headersSent) return next(error);
  const status = [400, 413, 415].includes(Number(error.status)) ? Number(error.status) : 500;
  if (status >= 500) console.error("Atlas API request failed:", error);
  const message = status === 413 ? "Request body is too large" : status === 415 ? "Unsupported request content type" : status === 400 ? "Invalid JSON request body" : "An internal server error occurred";
  res.status(status).json({ error: message });
});
var port = Number(process.env.PORT || 5173);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(staticDir));
  app.use((req, res) => res.sendFile(path3.join(staticDir, "index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ root: process.env.ATLAS_SOURCE_ROOT || root, server: { middlewareMode: true, host: "0.0.0.0", allowedHosts: true }, appType: "spa" });
  app.use(vite.middlewares);
}
var host = process.env.ATLAS_HOST || process.env.HOST || (isProduction ? "127.0.0.1" : "0.0.0.0");
app.listen(port, host, () => {
  console.log(`Atlas Workspace listening on http://${host}:${port}`);
  if (allowDemoData) console.log("Development demo data enabled via ATLAS_ALLOW_DEMO_DATA=true");
  else console.log(`Production-safe mode: no default or demo credentials; ${store.configured ? "workspace configured" : "first-run setup required"}`);
});
