// Schema version 1: the whole Atlas data model as relational tables.
//
// Conventions
//  - STRICT tables: SQLite rejects a value of the wrong type instead of storing it.
//  - Calendar dates are 'YYYY-MM-DD' text in the workspace's time zone, timestamps are ISO-8601 UTC text, booleans are 0/1.
//  - "No value" is NULL, never ''. Custom fields are validated JSON objects.
//  - Foreign keys carry the same delete rules the application always applied by hand: deleting a project removes its
//    tasks, milestones and alerts; deleting a person un-assigns their tasks; deleting a task keeps its alerts.
//  - work_logs (the ledger) has no foreign keys on purpose: history must outlive the tasks, projects and people it names.
//  - audit_log is append-only (triggers); only the retention job may remove rows, and only by raising a flag first.
//  - The v_* views are the read model for exports and reports. They join names onto ids and never expose secrets
//    (v_user_rows has no password_hash), so anything built on them cannot leak a credential.
export const initialSchema = {
  version: 1,
  name: 'initial schema',
  sql: `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  document TEXT NOT NULL CHECK (json_valid(document) AND json_type(document) = 'object'),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  color TEXT NOT NULL DEFAULT 'purple',
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  email TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  focus TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 70 CHECK (capacity BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'On track',
  color TEXT NOT NULL DEFAULT 'purple',
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX people_team ON people(team_id);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  email TEXT NOT NULL CHECK (length(trim(email)) > 0),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer',
  person_id TEXT UNIQUE REFERENCES people(id) ON DELETE RESTRICT,
  avatar_color TEXT NOT NULL DEFAULT 'purple',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  password_changed_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX users_email_uq ON users(lower(trim(email)));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id, created_at);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) > 0),
  code TEXT NOT NULL CHECK (length(code) > 0),
  description TEXT NOT NULL DEFAULT '',
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  owner_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT 'purple',
  status TEXT NOT NULL DEFAULT 'On track',
  deadline TEXT CHECK (deadline IS NULL OR date(deadline) IS deadline),
  created_at TEXT NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX projects_code_uq ON projects(upper(code));
CREATE INDEX projects_team ON projects(team_id);
CREATE INDEX projects_owner ON projects(owner_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) > 0),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignee_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  due_date TEXT CHECK (due_date IS NULL OR date(due_date) IS due_date),
  status TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Development',
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES people(id) ON DELETE SET NULL,
  completed_at TEXT CHECK (completed_at IS NULL OR date(completed_at) IS completed_at),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX tasks_project ON tasks(project_id, due_date);
CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX tasks_status ON tasks(status);
CREATE INDEX tasks_due ON tasks(due_date);
CREATE INDEX tasks_key ON tasks(key);
CREATE INDEX tasks_created_by ON tasks(created_by);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  due_date TEXT CHECK (due_date IS NULL OR date(due_date) IS due_date),
  status TEXT NOT NULL DEFAULT 'Upcoming',
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX milestones_project ON milestones(project_id, due_date);
CREATE INDEX milestones_due ON milestones(due_date);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  date TEXT NOT NULL CHECK (date(date) IS date),
  time TEXT NOT NULL DEFAULT '',
  yesterday TEXT NOT NULL DEFAULT '',
  today TEXT NOT NULL DEFAULT '',
  blocked TEXT NOT NULL DEFAULT '',
  upcoming TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Confirmed',
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX activities_date ON activities(date, time);
CREATE INDEX activities_person ON activities(person_id, date);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) > 0),
  body TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'info',
  tone TEXT NOT NULL DEFAULT 'blue',
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  created_at TEXT NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields) AND json_type(custom_fields) = 'object'),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX alerts_open ON alerts(resolved, created_at);
CREATE INDEX alerts_project ON alerts(project_id);
CREATE INDEX alerts_task ON alerts(task_id);

CREATE TABLE work_logs (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT,
  assignee_id TEXT,
  task_id INTEGER,
  project_id INTEGER,
  task_key TEXT,
  task_title TEXT,
  project_name TEXT,
  action TEXT NOT NULL,
  status_from TEXT NOT NULL DEFAULT '',
  status_to TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  at TEXT,
  source TEXT NOT NULL DEFAULT 'Task event',
  derived INTEGER NOT NULL DEFAULT 0 CHECK (derived IN (0, 1)),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX work_logs_date ON work_logs(date);
CREATE INDEX work_logs_person ON work_logs(person_id, date);
CREATE INDEX work_logs_task ON work_logs(task_id);

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  created_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  prev_hash TEXT NOT NULL DEFAULT '',
  hash TEXT
) STRICT;
CREATE INDEX audit_created ON audit_log(created_at);
CREATE INDEX audit_action ON audit_log(action, created_at);

CREATE TABLE audit_maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
) STRICT;
INSERT INTO audit_maintenance(id, enabled) VALUES (1, 0);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
WHEN (SELECT enabled FROM audit_maintenance WHERE id = 1) = 0
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only; only the retention job may remove rows');
END;

-- Full-text search (SQLite FTS5) over the records people look for. External-content tables: the text lives once, in
-- the base table, and triggers keep the index in step.
CREATE VIRTUAL TABLE task_search USING fts5(title, key, content='tasks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER tasks_search_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO task_search(rowid, title, key) VALUES (new.id, new.title, new.key);
END;
CREATE TRIGGER tasks_search_delete AFTER DELETE ON tasks BEGIN
  INSERT INTO task_search(task_search, rowid, title, key) VALUES ('delete', old.id, old.title, old.key);
END;
CREATE TRIGGER tasks_search_update AFTER UPDATE OF title, key ON tasks BEGIN
  INSERT INTO task_search(task_search, rowid, title, key) VALUES ('delete', old.id, old.title, old.key);
  INSERT INTO task_search(rowid, title, key) VALUES (new.id, new.title, new.key);
END;

CREATE VIRTUAL TABLE project_search USING fts5(name, code, description, content='projects', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER projects_search_insert AFTER INSERT ON projects BEGIN
  INSERT INTO project_search(rowid, name, code, description) VALUES (new.id, new.name, new.code, new.description);
END;
CREATE TRIGGER projects_search_delete AFTER DELETE ON projects BEGIN
  INSERT INTO project_search(project_search, rowid, name, code, description) VALUES ('delete', old.id, old.name, old.code, old.description);
END;
CREATE TRIGGER projects_search_update AFTER UPDATE OF name, code, description ON projects BEGIN
  INSERT INTO project_search(project_search, rowid, name, code, description) VALUES ('delete', old.id, old.name, old.code, old.description);
  INSERT INTO project_search(rowid, name, code, description) VALUES (new.id, new.name, new.code, new.description);
END;

-- Read model --------------------------------------------------------------------------------------------------------
CREATE VIEW v_task_rows AS
SELECT t.id, t.key, t.title, t.project_id, p.name AS project_name, p.code AS project_code,
       t.assignee_id, a.name AS assignee_name, a.email AS assignee_email, tm.name AS team_name,
       t.priority, t.status, t.type, t.blocked, t.due_date, t.created_at, t.created_by, c.name AS created_by_name,
       t.completed_at, t.custom_fields, t.sample
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN people a ON a.id = t.assignee_id
LEFT JOIN teams tm ON tm.id = p.team_id
LEFT JOIN people c ON c.id = t.created_by;

CREATE VIEW v_project_rows AS
SELECT p.id, p.name, p.code, p.description, p.team_id, tm.name AS team_name, p.owner_id, o.name AS owner_name,
       p.color, p.status, p.deadline, p.created_at, p.custom_fields, p.sample,
       (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
       (SELECT count(*) FROM milestones m WHERE m.project_id = p.id) AS milestone_count
FROM projects p
LEFT JOIN teams tm ON tm.id = p.team_id
LEFT JOIN people o ON o.id = p.owner_id;

CREATE VIEW v_milestone_rows AS
SELECT m.id, m.name, m.project_id, p.name AS project_name, p.code AS project_code, o.name AS owner_name,
       m.due_date, m.status, m.custom_fields, m.sample
FROM milestones m
JOIN projects p ON p.id = m.project_id
LEFT JOIN people o ON o.id = p.owner_id;

CREATE VIEW v_person_rows AS
SELECT pe.rowid AS seq, pe.id, pe.name, pe.email, pe.job_title, pe.team_id, tm.name AS team_name, pe.focus, pe.capacity, pe.status,
       pe.color, pe.custom_fields, pe.sample,
       (SELECT count(*) FROM tasks t WHERE t.assignee_id = pe.id) AS task_count
FROM people pe
LEFT JOIN teams tm ON tm.id = pe.team_id;

CREATE VIEW v_activity_rows AS
SELECT a.id, a.person_id, pe.name AS person_name, tm.name AS team_name, a.date, a.time,
       a.yesterday, a.today, a.blocked, a.upcoming, a.status, a.custom_fields, a.sample
FROM activities a
LEFT JOIN people pe ON pe.id = a.person_id
LEFT JOIN teams tm ON tm.id = pe.team_id;

CREATE VIEW v_alert_rows AS
SELECT al.id, al.title, al.body, al.type, al.tone, al.project_id, p.name AS project_name, al.task_id,
       t.key AS task_key, al.resolved, al.created_at, al.custom_fields, al.sample
FROM alerts al
LEFT JOIN projects p ON p.id = al.project_id
LEFT JOIN tasks t ON t.id = al.task_id;

CREATE VIEW v_user_rows AS
SELECT u.rowid AS seq, u.id, u.name, u.email, u.role, u.person_id, pe.name AS person_name, tm.name AS team_name,
       u.avatar_color, u.active, u.created_at, u.last_login_at, u.password_changed_at, u.must_change_password, u.sample
FROM users u
LEFT JOIN people pe ON pe.id = u.person_id
LEFT JOIN teams tm ON tm.id = pe.team_id;

CREATE VIEW v_audit_rows AS
SELECT a.seq, a.id, a.action, a.actor_id, COALESCE(u.name, NULLIF(a.actor_id, ''), 'system') AS actor_name,
       a.created_at, a.ip, a.detail
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_id;

INSERT INTO meta(key, value) VALUES
  ('revision', '0'),
  ('configured', '0'),
  ('audit_anchor', ''),
  ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('updated_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`
}
