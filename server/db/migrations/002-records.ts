// Schema version 2: what working with many records at once needs.
//  - tags / task_tags: free-form labels on tasks (bulk tagging, filtering and exporting by tag);
//  - task_trash: a recoverable copy of every deleted task, so a delete (single or bulk) can be undone for 30 days;
//  - saved_views: a person's named table settings (columns, sort, filters, page size), private or shared;
//  - v_task_rows now carries each task's tags, so exports and printing read them from the same view.
export const recordsSchema = {
  version: 2,
  name: 'tags, task trash, saved views',
  sql: `
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 40),
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX tags_name_uq ON tags(lower(name));

CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX task_tags_tag ON task_tags(tag_id);

CREATE TABLE task_trash (
  task_id INTEGER PRIMARY KEY,
  batch TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX task_trash_batch ON task_trash(batch);
CREATE INDEX task_trash_age ON task_trash(deleted_at);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 60),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 80),
  config TEXT NOT NULL CHECK (json_valid(config) AND json_type(config) = 'object'),
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX saved_views_name ON saved_views(user_id, scope, lower(name));
CREATE INDEX saved_views_scope ON saved_views(scope, shared);

DROP VIEW v_task_rows;
CREATE VIEW v_task_rows AS
SELECT t.id, t.key, t.title, t.project_id, p.name AS project_name, p.code AS project_code,
       t.assignee_id, a.name AS assignee_name, a.email AS assignee_email, tm.name AS team_name,
       t.priority, t.status, t.type, t.blocked, t.due_date, t.created_at, t.created_by, c.name AS created_by_name,
       t.completed_at, t.custom_fields, t.sample,
       (SELECT group_concat(name, ', ') FROM (
          SELECT g.name AS name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = t.id ORDER BY lower(g.name)
        )) AS tags
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN people a ON a.id = t.assignee_id
LEFT JOIN teams tm ON tm.id = p.team_id
LEFT JOIN people c ON c.id = t.created_by;
`
}
