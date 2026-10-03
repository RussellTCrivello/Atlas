# Atlas Workspace API Reference

## API conventions

- Base URL: same origin as the Atlas application.
- Authentication: HTTP-only `atlas_sid` cookie.
- Request bodies: JSON.
- Error format: `{ "error": "Message" }`.
- Authorization: role permissions enforced server-side. Workspace settings, runtime metadata, account administration, and all-person activity data are Administrator-only.
- Authentication is local email/password with Atlas-managed accounts; no external identity provider or SSO is used.
- Production first-run: setup routes are available before authentication; operational routes require authentication.

## Roles and permissions

| Role | Permissions |
| --- | --- |
| Administrator | Settings, users, projects, people, alerts, tasks, activity, reports, exports, demo-data removal. |
| Manager | Projects, people, alerts, tasks, activity, reports, exports. |
| Developer | Task updates, activity logging, reports, exports. |
| Viewer | Read reports and export permitted data. |

Internal permission names:

- `manageSettings`
- `manageUsers`
- `manageProjects`
- `managePeople`
- `manageAlerts`
- `manageTasks`
- `writeTasks`
- `logActivity`
- `viewReports`
- `exportData`
- `removeDemoData`

## Public/system routes

### `GET /api/health`

Returns service health.

Response includes:

- `ok`
- `name`
- `version`
- `mode`
- `desktopReady`
- `time`

### `GET /api/runtime-config`

Requires authentication and the `Administrator` role. Returns runtime packaging, design-system, and database metadata.

Important fields:

- `packagingMode`
- `designSystem.version`
- `designSystem.localFonts`
- `designSystem.externalUiAssets`
- `database.fileName`
- `database.storeModel`
- `database.schemaVersion`
- `database.atomicWrites`
- `database.backupRetention`
- `packaging.web`
- `packaging.pwa`
- `packaging.localAssets`

### `GET /api/setup/status`

Returns first-run setup state.

Production response example:

```json
{
  "configured": false,
  "demoAllowed": false,
  "demo": null
}
```

Demo accounts appear only when `ATLAS_ALLOW_DEMO_DATA=true`.

### `POST /api/setup`

Creates the first administrator and configures the workspace.

Body:

```json
{
  "name": "Alex Admin",
  "email": "alex@example.com",
  "password": "StrongPass123",
  "workspaceName": "Atlas Workspace",
  "workspaceUnit": "Operations",
  "includeDemo": false
}
```

Rules:

- `name`, `email`, and a password of at least eight characters are required.
- `includeDemo` is honored only when `ATLAS_ALLOW_DEMO_DATA=true`.
- Creates an administrator user, linked person profile, and initial team.
- Starts a session by setting `atlas_sid`.

## Authentication routes

### `POST /api/auth/login`

Body:

```json
{ "email": "alex@example.com", "password": "StrongPass123" }
```

Response:

```json
{ "user": { "id": "...", "name": "...", "role": "Administrator", "permissions": [] } }
```

### `POST /api/auth/logout`

Clears the current session.

### `GET /api/auth/me`

Returns the current authenticated user.

## Bootstrap

### `GET /api/bootstrap`

Requires authentication.

Returns the data required by the UI shell:

- `today`, `user`, `teams`, `people`, `projects`, `tasks`, `activity`, `alerts`, `dashboard`, and aggregate `reports`.
- `settings` is the complete configuration only for an Administrator. Other roles receive only the UI/runtime fields required to render the workspace; security, audit, retention, integration, and role-permission policy settings are omitted.
- `users` is populated only for an Administrator.
- Ordinary users receive only their own daily activity, activity-based alerts, and individual activity dashboard items. `teamActivitySummary` and overall delivery reporting contain non-identifying aggregate counts.

Public user objects never include password hashes. Ordinary users cannot request another person’s activity by changing a query parameter or export scope; server-side scoping overrides the supplied person id. Individual activity rankings and all-person evidence reports are Administrator-only.

## Personal preferences

### `GET /api/preferences`

Requires authentication and returns the current account's saved-filter map and optional personal UI language.

### `PUT /api/preferences`

Accepts `filters`, `language`, or both. `language` must name an enabled workspace language; the empty string means use the workspace default. Each user's value is stored in SQLite and is separate from the administrator-controlled workspace default. Preference writes are included in the offline outbox.

## Reports

### `GET /api/reports/:period`

Requires `viewReports`.

Allowed periods:

- `daily`
- `weekly`
- `monthly`
- `quarterly`
- `yearly`

Returns general delivery reporting:

- `series`
- `completed`
- `planned`
- `deliveryRate`
- `remainingTasks`
- `activeProjects`
- `completedProjects`
- `blockedTasks`
- `overdue`
- `alerts`
- `projectRows`

### `GET /api/reports/activity/:period?userId=all|<personId>`

Requires `viewReports`. Administrators may request `all` or a selected person. Every other role is forcibly scoped to the authenticated user’s linked person profile; a requested `userId` is ignored. A user without a linked person receives an empty personal report.

Allowed periods:

- `daily`
- `weekly`
- `monthly`

Examples:

```txt
/api/reports/activity/daily?userId=all              # Administrator: all people
/api/reports/activity/weekly?userId=<personId>      # Administrator: one person
/api/reports/activity/monthly?userId=<any-value>    # Non-admin: own person only
```

Returns:

- `period`
- `scope`
- `generatedAt`
- `series`
- `users`
- `projects`
- `rows`
- `totals`

Rows include:

- date/time
- period key/label
- person and role
- project id/name/code
- task display id and title
- action
- status from/to
- summary
- minutes
- source

This endpoint is the source for user activity intelligence and aggregate activity reports.

## Settings and system

### `GET /api/system`

Requires Administrator.

Returns database integrity, schema metadata, checksum, backups, and collection counts.

### `PUT /api/settings`

Requires the `Administrator` role (not merely a custom permission such as `manageSettings`).

Body: partial or full settings object.

Returns updated settings.

All global settings, settings import/export, system metadata, user-account administration, and the full translation catalog require the `Administrator` role. The navigation and command search omit Settings for other roles, and the UI also guards direct settings navigation.

### `DELETE /api/setup/seed`

Requires Administrator with `removeDemoData`.

Removes records marked `sample: true` while preserving active user-linked people.

## Tasks

### `POST /api/tasks`

Requires `writeTasks`.

Body fields:

- `title`
- `projectId`
- `assigneeId`
- `priority`
- `dueDate`
- `status`
- `type`
- `blocked`

Creates a task and a `Created task` work-log event.

### `PUT /api/tasks/:id`

Requires `writeTasks`.

Updates editable task fields and writes an `Updated task` work-log event.

### `PATCH /api/tasks/:id/status`

Requires `writeTasks`.

Body:

```json
{ "status": "Done" }
```

or

```json
{ "advance": true }
```

Writes `Moved task` or `Completed task` work-log events when the status changes.

### `DELETE /api/tasks/:id`

Requires `manageTasks`.

Deletes a task.

## Projects

### `GET /api/projects/:id/tasks`

Requires authentication. Reads a fresh SQLite snapshot and returns the project plus **all** associated tasks and milestones; it does not return only the currently visible task-board rows.

Response shape:

```json
{
  "source": "sqlite",
  "project": { "numericId": 42, "name": "..." },
  "tasks": [],
  "milestones": [],
  "generatedAt": "..."
}
```

### `POST /api/projects`

Requires `manageProjects`.

Creates a project.

### `PUT /api/projects/:id`

Requires `manageProjects`.

Updates a project.

### `DELETE /api/projects/:id`

Requires `manageProjects`.

Deletes the project and associated tasks/milestones.

## People and teams

### `POST /api/people`

Requires `managePeople`.

Creates a person profile.

### `PUT /api/people/:id`

Requires `managePeople`.

Updates a person profile.

### `DELETE /api/people/:id`

Requires `managePeople`.

Cannot delete a person linked to an active user account.

### `POST /api/teams`

Requires `managePeople`.

Creates a team.

### `PUT /api/teams/:id`

Requires `managePeople`.

Updates a team.

### `DELETE /api/teams/:id`

Requires `managePeople`.

Cannot delete a team while people reference it.

## Milestones

### `POST /api/milestones`

Requires `manageProjects`.

### `PUT /api/milestones/:id`

Requires `manageProjects`.

### `DELETE /api/milestones/:id`

Requires `manageProjects`.

## Activity

### `POST /api/activity`

Requires `logActivity`.

Creates a daily activity record and writes a work-log event.

Fields:

- `personId`
- `yesterday`
- `today`
- `blocked`
- `upcoming`
- `status`

## Alerts

### `POST /api/alerts`

Requires `manageAlerts`.

### `PUT /api/alerts/:id`

Requires `manageAlerts`.

### `PATCH /api/alerts/:id/resolve`

Requires `writeTasks` or alert management role.

### `DELETE /api/alerts/:id`

Requires `manageAlerts`.

## Exports

### `POST /api/exports/prepare`

Requires `exportData`. Report datasets additionally require `viewReports`; the `users` dataset additionally requires `manageUsers`.

Prepares selected rows/fields from a fresh SQLite snapshot. The client sends identifiers and selected field keys, never screen-rendered row values. `fields` are checked against the dataset schema and configured visible custom-field definitions; user secrets such as password hashes are not allowlisted.

Example body:

```json
{
  "dataset": "tasks",
  "recordIds": [41, 42],
  "fields": ["id", "title", "status", "due", "customFields.client_code"],
  "query": { "projectId": 7 }
}
```

Supported datasets: `projects`, `tasks`, `people`, `activity`, `alerts`, `milestones`, `users`, `delivery-report`, `activity-evidence`, `activity-summary`, and `project-contributions`. `delivery-report` accepts `period` (`daily`, `weekly`, `monthly`, `quarterly`, `yearly`); activity datasets accept `period` (`daily`, `weekly`, `monthly`) and optional `personId`. Task queries accept `projectId`. If `recordIds` or `fields` are omitted, all rows/allowlisted fields for that dataset are selected. At least one field is required when `fields` is supplied. There is no artificial record-count ceiling; practical payload and memory limits still apply. Non-administrators are forced to their own scope for individual activity/evidence exports. Project-contribution exports may return only workspace-level aggregates.

Response includes `source: "sqlite"`, `dataset`, `generatedAt`, `recordCount`, database-derived `columns`, and `rows`.

### `POST /api/audit/export`

Requires `exportData`. Records the title, format, and row count of an export/print request in the workspace audit log when audit tracking is enabled.

## Users/access control

### `POST /api/users`

Requires Administrator with `manageUsers`.

Creates a login account and optionally links or creates a person profile.

### `PUT /api/users/:id`

Requires Administrator with `manageUsers`.

Updates name, email, role, linked person, avatar, active state, and password when provided.

### `DELETE /api/users/:id`

Requires Administrator with `manageUsers`.

Safety rules:

- Cannot delete your own account.
- Cannot delete the last active administrator.

### `GET /api/profile`

Requires authentication and returns only the current account's public profile fields.

### `PUT /api/profile`

Allows a signed-in user to change only their own display name and avatar color. When linked to a workspace person, those two visible identity fields stay in sync. Email, password, role, and account status remain administrator-managed. Profile updates use field-aware offline conflict checks.

