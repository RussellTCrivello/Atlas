# Atlas Workspace API Reference

## API conventions

- Base URL: same origin as the Atlas application.
- Authentication: HTTP-only `atlas_sid` cookie.
- Request bodies: JSON.
- Error format: `{ "error": "Message" }`.
- Authorization: role permissions enforced server-side.
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

Returns runtime packaging, design-system, and database metadata.

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

Returns all data required by the UI shell:

- `today`
- `user`
- `settings`
- `teams`
- `people`
- `users`
- `projects`
- `tasks`
- `activity`
- `alerts`
- `dashboard`
- `reports`

Public user objects never include password hashes.

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

Requires `viewReports`.

Allowed periods:

- `daily`
- `weekly`
- `monthly`

Use cases:

```txt
/api/reports/activity/daily?userId=all
/api/reports/activity/weekly?userId=all
/api/reports/activity/monthly?userId=<personId>
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

Requires Administrator.

Body: partial or full settings object.

Returns updated settings.

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

