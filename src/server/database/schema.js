const field = (type, options = {}) => ({ type, ...options })

export const COLLECTIONS = {
  teams: {
    fields: {
      name: field('TEXT'), color: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['name', 'NOCASE']],
    uniqueIndexes: [['name', 'NOCASE']]
  },
  people: {
    fields: {
      name: field('TEXT'), email: field('TEXT'), jobTitle: field('TEXT'), teamId: field('REFERENCE', { target: 'teams', onDelete: 'RESTRICT' }),
      focus: field('TEXT'), capacity: field('REAL'), status: field('TEXT'), color: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['teamId'], ['status']],
    uniqueIndexes: [['email', 'NOCASE']],
    foreignKeys: [['teamId', 'teams', 'RESTRICT']]
  },
  projects: {
    fields: {
      name: field('TEXT'), code: field('TEXT'), description: field('TEXT'), teamId: field('REFERENCE', { target: 'teams', onDelete: 'RESTRICT' }),
      ownerId: field('REFERENCE', { target: 'people', onDelete: 'RESTRICT' }), color: field('TEXT'), status: field('TEXT'), deadline: field('TEXT'),
      createdAt: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['teamId'], ['ownerId'], ['status'], ['deadline']],
    uniqueIndexes: [['code', 'NOCASE']],
    foreignKeys: [['teamId', 'teams', 'RESTRICT'], ['ownerId', 'people', 'RESTRICT']]
  },
  tasks: {
    fields: {
      title: field('TEXT'), projectId: field('REFERENCE', { target: 'projects', onDelete: 'CASCADE' }), assigneeId: field('REFERENCE', { target: 'people', onDelete: 'RESTRICT' }),
      priority: field('TEXT'), dueDate: field('TEXT'), status: field('TEXT'), type: field('TEXT'), blocked: field('BOOLEAN'), createdAt: field('TEXT'),
      completedAt: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['projectId'], ['assigneeId'], ['status'], ['priority'], ['dueDate']],
    foreignKeys: [['projectId', 'projects', 'CASCADE'], ['assigneeId', 'people', 'RESTRICT']]
  },
  milestones: {
    fields: {
      name: field('TEXT'), projectId: field('REFERENCE', { target: 'projects', onDelete: 'CASCADE' }), dueDate: field('TEXT'), status: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['projectId'], ['status'], ['dueDate']],
    foreignKeys: [['projectId', 'projects', 'CASCADE']]
  },
  activities: {
    fields: {
      personId: field('REFERENCE', { target: 'people', onDelete: 'RESTRICT' }), date: field('TEXT'), time: field('TEXT'), yesterday: field('TEXT'), today: field('TEXT'),
      blocked: field('TEXT'), upcoming: field('TEXT'), status: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['personId'], ['date']],
    foreignKeys: [['personId', 'people', 'RESTRICT']]
  },
  alerts: {
    fields: {
      title: field('TEXT'), body: field('TEXT'), type: field('TEXT'), tone: field('TEXT'), projectId: field('REFERENCE', { target: 'projects', onDelete: 'CASCADE' }),
      taskId: field('REFERENCE', { target: 'tasks', onDelete: 'CASCADE' }), personId: field('TEXT'), activityId: field('TEXT'), source: field('TEXT'),
      occurrences: field('INTEGER'), resolved: field('BOOLEAN'), createdAt: field('TEXT'), lastSeenAt: field('TEXT'), sample: field('BOOLEAN'), customFields: field('JSON')
    },
    indexes: [['projectId'], ['taskId'], ['personId'], ['resolved'], ['type'], ['createdAt']],
    foreignKeys: [['projectId', 'projects', 'CASCADE'], ['taskId', 'tasks', 'CASCADE']]
  },
  users: {
    fields: {
      name: field('TEXT'), email: field('TEXT'), passwordHash: field('TEXT'), role: field('TEXT'), personId: field('REFERENCE', { target: 'people', onDelete: 'RESTRICT' }),
      avatarColor: field('TEXT'), active: field('BOOLEAN'), createdAt: field('TEXT'), sample: field('BOOLEAN')
    },
    indexes: [['personId'], ['role'], ['active']],
    uniqueIndexes: [['email', 'NOCASE']],
    foreignKeys: [['personId', 'people', 'RESTRICT']]
  },
  workLogs: {
    table: 'work_logs',
    fields: {
      personId: field('REFERENCE'), actorUserId: field('REFERENCE'), taskId: field('REFERENCE'), projectId: field('REFERENCE'), taskTitle: field('TEXT'), projectName: field('TEXT'),
      projectCode: field('TEXT'), action: field('TEXT'), statusFrom: field('TEXT'), statusTo: field('TEXT'), summary: field('TEXT'), date: field('TEXT'),
      time: field('TEXT'), minutes: field('REAL'), sample: field('BOOLEAN'), source: field('TEXT')
    },
    indexes: [['personId'], ['taskId'], ['projectId'], ['date'], ['action']]
  },
  auditLogs: {
    table: 'audit_logs',
    fields: { action: field('TEXT'), actorId: field('TEXT'), detail: field('JSON'), createdAt: field('TEXT'), source: field('TEXT') },
    indexes: [['action'], ['actorId'], ['createdAt']]
  }
}

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`
const sqlType = (definition) => definition.type === 'BOOLEAN' ? 'INTEGER' : definition.type === 'REFERENCE' ? 'TEXT' : definition.type === 'JSON' ? 'TEXT' : definition.type

function createCollectionTable(tableName, definition) {
  const columns = [
    'id TEXT NOT NULL PRIMARY KEY',
    "id_type TEXT NOT NULL CHECK(id_type IN ('string', 'number'))",
    'ordinal INTEGER NOT NULL CHECK(ordinal >= 0)'
  ]
  for (const [property, spec] of Object.entries(definition.fields)) {
    const column = quoteIdentifier(toSnakeCase(property))
    const type = sqlType(spec)
    const checks = []
    if (spec.type === 'BOOLEAN') checks.push(`${column} IS NULL OR ${column} IN (0, 1)`)
    if (spec.type === 'JSON') checks.push(`${column} IS NULL OR json_valid(${column})`)
    columns.push(`${column} ${type}${checks.length ? ` CHECK(${checks.join(' AND ')})` : ''}`)
  }
  columns.push('attributes_json TEXT NOT NULL CHECK(json_valid(attributes_json))')
  columns.push('present_json TEXT NOT NULL CHECK(json_valid(present_json))')
  columns.push('field_states_json TEXT NOT NULL CHECK(json_valid(field_states_json))')
  columns.push('row_hash TEXT NOT NULL')
  for (const [property, target, onDelete] of definition.foreignKeys || []) {
    columns.push(`FOREIGN KEY(${quoteIdentifier(toSnakeCase(property))}) REFERENCES ${quoteIdentifier(target)}(id) ON DELETE ${onDelete} DEFERRABLE INITIALLY DEFERRED`)
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (${columns.join(', ')}) STRICT`
}

function toSnakeCase(value) { return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) }

export function migrateDatabase(db) {
  const currentVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0)
  if (currentVersion > 1) throw new Error(`Database schema ${currentVersion} is newer than this application supports (1)`)
  if (currentVersion === 1) return

  db.exec('BEGIN IMMEDIATE')
  try {
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
    `)
    for (const [name, definition] of Object.entries(COLLECTIONS)) db.exec(createCollectionTable(definition.table || name, definition))
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
      INSERT INTO schema_migrations(version, name, applied_at) VALUES(1, 'initial-relational-schema', datetime('now'));
    `)
    db.exec('PRAGMA user_version = 1')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
