# API reference

All routes are under `/api`, speak JSON and are served by the same process as the UI. The browser UI is the only first-party
client; the API is not versioned and may change between releases (see `CHANGELOG.md`).

## Conventions

- **Authentication**: a session cookie `atlas_sid` (HttpOnly, SameSite=Lax) created by `POST /api/setup` or
  `POST /api/auth/login`. Everything except the _Public_ routes below returns `401 {code:"UNAUTHENTICATED"}` without one.
- **Forced password change**: while an account is flagged `mustChangePassword`, every authenticated route except
  `/api/auth/me`, `/api/auth/password` and `/api/auth/logout*` returns `403 {code:"PASSWORD_CHANGE_REQUIRED"}`.
- **Writes** need `Content-Type: application/json`, a body ≤ 1 MB, and (from a browser) an `Origin` that matches `Host`.
  The `Host` header must be allowed (`ATLAS_ALLOWED_HOSTS`).
- **Errors** are always JSON: `{ "error": "human readable", "code": "MACHINE_CODE", "details": … }`. Validation failures are
  `400` with `code:"VALIDATION_FAILED"` and `details: [{field, message}]`. Other codes in use: `UNAUTHENTICATED` 401,
  `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT`/`DUPLICATE_EMAIL`/`DUPLICATE_CODE`/`ALREADY_CONFIGURED`/`HAS_DEPENDENTS`/
  `TRANSITION_NOT_ALLOWED`/`PERSON_ALREADY_LINKED`/`NEEDS_REAL_ADMIN` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429 (with
  `Retry-After`), `STORAGE_UNAVAILABLE`/`BACKUP_FAILED`/`BUSY` 503, `INTERNAL` 500 (message contains a reference id also sent
  as `X-Request-Id`; the stack is only in the server log). Unknown `/api/*` paths return JSON `404`, never HTML.
- Unknown request fields are ignored; known fields are validated (types, lengths, enums, `YYYY-MM-DD` dates, references).
- Responses are `Cache-Control: no-store` and gzip-compressed when large.
- `PUT` on tasks, projects, people, teams, milestones changes only the fields present in the body.

## Roles and permissions

Permissions: `manageSettings`, `manageUsers`, `manageProjects`, `managePeople`, `manageAlerts`, `manageTasks`, `writeTasks`,
`logActivity`, `viewReports`, `exportData`, `removeDemoData`. Default roles (editable, plus custom roles):

| Role          | Permissions                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Administrator | all (always keeps `manageSettings` and `manageUsers`)                                                                     |
| Manager       | `manageProjects`, `managePeople`, `manageAlerts`, `manageTasks`, `writeTasks`, `logActivity`, `viewReports`, `exportData` |
| Developer     | `writeTasks`, `logActivity`, `viewReports`, `exportData`                                                                  |
| Viewer        | `viewReports`, `exportData`                                                                                               |

A user whose role no longer exists gets Viewer permissions. Permissions are evaluated on every request from the current role
registry.

## Public routes

| Route                         | Notes                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`             | `200 {ok:true,name,version,mode,storage:{writable,lastSavedAt},time}` or **`503`** when the store cannot be written.                                                                                                                                                                                                                                                        |
| `GET /api/runtime-config`     | Packaging/design info. Includes `database` (file name, schema version, retention) only for administrators.                                                                                                                                                                                                                                                                  |
| `GET /api/setup/status`       | `{configured, tokenRequired, demoAllowed, demo}`. `demo` (public demo accounts) is non-null only on a **development** server with `ATLAS_ALLOW_DEMO_DATA=true`, for loopback callers.                                                                                                                                                                                       |
| `POST /api/setup`             | First run only. Body: `{name, email, password, token, workspaceName?, workspaceUnit?, settings?, includeDemo?}`. `token` is the one-time setup token. `settings` is a merge patch over the defaults. Returns `{setup:{configured:true}, user}` and a session cookie. `403 SETUP_TOKEN_REQUIRED`, `400 WEAK_PASSWORD`, **`409 ALREADY_CONFIGURED` once a workspace exists**. |
| `POST /api/auth/login`        | `{email, password}` → `{user}` + cookie. `401 INVALID_CREDENTIALS` (same message for unknown account and wrong password), `403 ACCOUNT_DISABLED`, `429 RATE_LIMITED`. A fresh session token is issued every time.                                                                                                                                                           |
| `POST /api/auth/logout`       | Revokes the session server-side and clears the cookie.                                                                                                                                                                                                                                                                                                                      |
| `GET /api/i18n/catalog?lang=` | Built-in translations merged with administrator overrides for that language. No registry metadata.                                                                                                                                                                                                                                                                          |

## Account routes (any signed-in user)

| Route                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/me`          | `{user}` where `user` = `{id,name,email,role,personId,avatarColor,active,mustChangePassword,permissions[]}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/auth/password`   | `{currentPassword, newPassword}`. Policy applies; other sessions of the account are revoked, this one stays. Throttled like sign-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/auth/logout-all` | Revokes every session of the account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/bootstrap`        | Everything the UI needs, **scoped by role**: `{today, revision, user, settings, teams, people, users, projects, tasks, activity, alerts, dashboard, reports}`. `users` is `[]` unless `manageUsers`; `settings` is the full tree for `manageSettings` and a render-only subset otherwise; `reports` is empty without `viewReports`. `dashboard.myTasks` and `dashboard.stats.myOpenTasks` are the caller's own open tasks. `dashboard.mostActive` is the four people who logged the most daily updates this week (`[{personId, name, color, updates}]`), or `null` for people who may see only their own activity (the rule for per-person activity reports; Settings > Reports). |
| `GET /api/revision`         | `{revision, serverTime}`: cheap change counter the UI polls every ~20 s and when the tab regains focus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/i18n/missing`    | `{key, language?, fallback?, source?}`: diagnostic report of an untranslated key. Kept in bounded server memory (max 200 keys), never persisted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/exports/audit`   | `{page, format, rows, columns}`; needs `exportData` (403 otherwise). Records the export in the audit trail. The UI calls it before generating a file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Reports (`viewReports`)

`GET /api/reports/:period` with `period` = `daily|weekly|monthly|quarterly|yearly` returns

```jsonc
{
  "period": "weekly",
  "series": [
    {
      "key": "2026-09-28",
      "label": "Wk Sep 28",
      "created": 4,
      "completed": 3,
      "planned": 5,
      "delivered": 4,
      "rate": 80
    }
  ],
  "created": 40,
  "completed": 31,
  "planned": 38,
  "delivered": 30,
  "deliveryRate": 79, // null when nothing came due
  "remainingTasks": 22,
  "activeProjects": 4,
  "completedProjects": 0,
  "blockedTasks": 3,
  "overdue": 5,
  "alerts": 2,
  "activities": 17,
  "definitions": { "created": "…", "completed": "…", "planned": "…", "delivered": "…", "deliveryRate": "…" }
}
```

`created`/`completed` are **distinct tasks per period from the work ledger**. `planned` = tasks whose due date fell in the period
and has passed; `delivered` = of those, completed on or before the due date; `rate = delivered ÷ planned` (always 0-100, `null`
when `planned` is 0). `remainingTasks`, `blockedTasks`, `overdue`, `alerts`, `activeProjects` describe _now_. Buckets start on
`workspace.weekStartsOn` (default Monday) in the workspace time zone; labels follow the workspace language with Latin digits.

`GET /api/reports/activity/:period?userId=all|<personId>&limit=500` with `period` = `daily|weekly|monthly` returns
`{period, userId, scope, restricted, series, users, projects, rows, rowsTotal, rowsTruncated, totals, definitions}`. All totals
count distinct tasks/people over **every** event in the window; `rows` is the newest `limit` events (default 500, max 5000).
There are no effort/time fields. **Visibility**: people with `managePeople` or `manageSettings`, or everyone when
`reports.activityVisibility = "everyone"`, can request any person; otherwise the answer is limited to the caller's own person
(`restricted:true`), and asking for someone else is `403`.

## Tasks

| Route                         | Permission    | Notes                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/tasks`             | `writeTasks`  | `{title, projectId, assigneeId?, priority?, dueDate?, status?, type?, blocked?, customFields?}`. Title and an existing project are required; `status` must be a workflow state; assignee defaults to the caller. `400` if no project exists yet.                  |
| `PUT /api/tasks/:id`          | `writeTasks`  | Partial update. Status, blocked flag and custom fields: anyone with `writeTasks`. **Title, project, assignee, priority, type, due date need `manageTasks` or a task assigned to / created by the caller** (`403` otherwise). `blocked` is only changed when sent. |
| `PATCH /api/tasks/:id/status` | `writeTasks`  | `{status}` or `{advance:true}`. Unknown statuses are `400`. If _Enforce transitions_ is on, only listed transitions (and their permission) are allowed (`409 TRANSITION_NOT_ALLOWED`).                                                                            |
| `DELETE /api/tasks/:id`       | `manageTasks` | `404` if it does not exist.                                                                                                                                                                                                                                       |

Task objects returned: `{numericId, id (frozen key), title, projectId, project, assigneeId, assignee, assigneeColor, priority,
dueDate, due (label), dueDays, dueTone, status, type, blocked, done, createdAt, createdBy, completedAt, customFields}`.
Enums: priority `Low|Medium|High`; type `Development|Design|Testing|Documentation`.

## Projects, people, teams, milestones, activity, alerts

| Route                                                   | Permission       | Notes                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST/PUT/DELETE /api/projects[/:id]`                   | `manageProjects` | `code` is 2-10 chars of `A-Z0-9_-`, unique (generated from the name when omitted). `DELETE` → `409 HAS_DEPENDENTS` with counts unless `?cascade=true` (then a backup is taken first). |
| `POST/PUT/DELETE /api/milestones[/:id]`                 | `manageProjects` | `projectId` must exist; status `Upcoming                                                                                                                                              | At risk  | Complete`. |
| `POST/PUT/DELETE /api/people[/:id]`, `/api/teams[/:id]` | `managePeople`   | `capacity` 0-100; e-mail optional but must be valid; referenced teams must exist. Deletion rules: `DATABASE_ARCHITECTURE.md`.                                                         |
| `POST /api/activity`                                    | `logActivity`    | At least one of `yesterday/today/blocked/upcoming`. Attributed to the caller's person; another `personId` needs `managePeople`.                                                       |
| `DELETE /api/activity/:id`                              | `manageTasks`    |                                                                                                                                                                                       |
| `POST /api/alerts`, `DELETE /api/alerts/:id`            | `manageAlerts`   | Type `info                                                                                                                                                                            | deadline | blocker    | risk | overdue`; `projectId`/`taskId` must exist when given. |
| `PATCH /api/alerts/:id`                                 | see note         | Resolving needs `writeTasks` or `manageAlerts`; editing other fields needs `manageAlerts`.                                                                                            |

## Users and settings

| Route                                                   | Permission       | Notes                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users`                                        | `manageUsers`    | Account directory (never contains hashes).                                                                                                                                                                                                                                         |
| `POST /api/users`                                       | `manageUsers`    | `{name, email, password, role?, personId?, active?, avatarColor?, mustChangePassword?}`. `mustChangePassword` defaults to **true**. Without `personId` a person profile is created. `409` for a duplicate e-mail or a person already linked to another account.                    |
| `PUT /api/users/:id`                                    | `manageUsers`    | Partial; `password` resets it (policy applies, sessions end, change forced unless `mustChangePassword:false`). Refused when it would leave no active administrator, for roles/accounts that outrank the caller, or when disabling yourself.                                        |
| `DELETE /api/users/:id`                                 | `manageUsers`    | Not yourself; not the last active administrator; not an account that outranks you.                                                                                                                                                                                                 |
| `PUT /api/settings`                                     | `manageSettings` | **Merge patch** (RFC 7386): send only what changes; `null` resets a key. Validated (time zone, enums, ranges, role names/permissions, workflow states). Removing a workflow state that tasks use is `400`; renaming one (same `id`) migrates its tasks. Returns the full settings. |
| `GET /api/settings/export`, `POST /api/settings/import` | `manageSettings` | Import replaces the whole tree after a **pre-settings-import** backup; both can be switched off (`storage.importExportEnabled`).                                                                                                                                                   |
| `DELETE /api/setup/seed`                                | `removeDemoData` | Removes `sample` rows **and the demo accounts**; refused (`409 NEEDS_REAL_ADMIN`) unless a real administrator exists. Backs up first.                                                                                                                                              |

## Localisation (`manageSettings`)

`GET/DELETE /api/i18n/missing` (runtime diagnostics), `GET /api/settings/translations/missing`, `POST /api/i18n/register`,
`PUT /api/i18n/translation`, `POST /api/i18n/bulk`. Entries identical to the built-in catalog are not stored.

## System (`manageSettings`)

| Route                      | Notes                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/system`          | Integrity, errors/warnings, checksum, audit-chain status, storage health, five newest backups, counts. |
| `POST /api/system/backup`  | Verified manual backup; fails (and says so) if it cannot be made.                                      |
| `GET /api/audit?limit=100` | Newest audit entries (actor names resolved) and chain status.                                          |

## Audit trail

Recorded with actor, IP and user agent: sign-ins and failures, throttling, denied requests, setup token rejections, user and
role changes, password changes/resets, settings changes (security and audit branches include before/after), imports, backups,
exports, record create/update/delete, demo removal. Failure-rate events are written in batches (every ~2 s) so a flood of bad
requests cannot become a flood of disk writes. `audit.enabled=false` stops routine entries; security events (`auth.*`,
`user.*`, `settings.*`, `system.*`, `setup.*`) are always recorded. `audit.trackWrites`, `trackExports` and `trackReads` are
honoured.
