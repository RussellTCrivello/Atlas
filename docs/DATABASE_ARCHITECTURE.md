# Data architecture

Atlas keeps its data in an **embedded JSON document store**: one file, held in memory by the server process, rewritten
atomically on every change. This document describes the model, the guarantees, and the point at which it stops being the right
tool. Code: `server/store.ts` (persistence), `server/migrations.ts` (shape, migrations, integrity),
`server/types.ts` (entities), `shared/settings.ts` (settings model).

## Files in the data directory

```text
<ATLAS_DATA_DIR>/            mode 0700 (default <project root>/data, independent of the working directory)
  atlas-store.json           the workspace (mode 0600)
  sessions.json              SHA-256 hashes of session tokens + user id + creation time (mode 0600)
  atlas.lock                 {pid, hostname, startedAt, token}: single-writer lock
  backups/atlas-store-<UTC timestamp>-<reason>.json
```

Do not edit `atlas-store.json` while the server runs. To repair by hand, stop the server first, run `npm run backup:data`,
edit, then `npm run check:data`.

## Why this model, and its limits

It needs no installation, is easy to back up and inspect, and works the same inside the desktop app. It also means:

- the whole state is in memory and the whole file is rewritten on each change (≈ 80 ms per write at 10,000 tasks);
- every browser receives all tasks at load (≈ 4 MB at 10,000 tasks);
- there is exactly one writer process;
- no queries or indexes: lookups are in-memory scans, built into per-request indexes where it matters.

**Rule of thumb: up to about 10,000 tasks.** The next step (not taken here, because the scale target is unknown and an embedded
SQLite or native module cannot be verified inside Electron in this environment) is server-side pagination of the list
endpoints, then moving collections to SQLite behind the same `DocumentStore.commit()` interface. See
`DECISIONS_AND_OPEN_QUESTIONS.md` (D11).

## Top-level shape (schema `3.1.0`)

```text
meta       { schemaVersion, model, createdAt, updatedAt, writeCount, lastMigrationAt, designSystemVersion, auditAnchor? }
configured boolean: false only before first-run setup completes
counters   { task, project }   next numeric ids (never reused)
settings   workspace configuration (see below); only administrator overrides of translations are stored
users, teams, people, projects, tasks, milestones, activities, alerts   operational records
workLogs   the work ledger (append-only facts)
auditLogs  hash-chained audit trail
```

### Entities

| Entity      | Fields (besides `sample?`, `customFields?`)                                                                                                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`      | `id, name, email, passwordHash, role, personId, avatarColor, active, createdAt, lastLoginAt?, passwordChangedAt?, mustChangePassword?`. Email is unique (case-insensitive, trimmed); a person profile belongs to at most one account.                                                                                                                                       |
| `team`      | `id, name, color`                                                                                                                                                                                                                                                                                                                                                           |
| `person`    | `id, name, email, jobTitle, teamId, focus, capacity (0-100), status, color`                                                                                                                                                                                                                                                                                                 |
| `project`   | `id (number), name, code (unique, 2-10 chars), description, teamId, ownerId, color, status, deadline, createdAt`                                                                                                                                                                                                                                                            |
| `task`      | `id (number), key, title, projectId, assigneeId, priority, dueDate ('' = none), status, type, blocked, createdAt, createdBy?, completedAt?`. **`key`** (for example `ATL-012`) is frozen at creation, so editing a project code never renames tasks. `status` stores the workflow state's _label_; states are matched by id when the workflow is edited (§ Workflow edits). |
| `milestone` | `id, name, projectId, dueDate, status`                                                                                                                                                                                                                                                                                                                                      |
| `activity`  | `id, personId, date, time, yesterday, today, blocked, upcoming, status`                                                                                                                                                                                                                                                                                                     |
| `alert`     | `id, title, body, type, tone, projectId, taskId, resolved, createdAt`                                                                                                                                                                                                                                                                                                       |
| `workLog`   | see below                                                                                                                                                                                                                                                                                                                                                                   |
| `auditLog`  | `id, action, actorId, detail, createdAt, ip?, userAgent?, prev, hash`                                                                                                                                                                                                                                                                                                       |

Dates are `YYYY-MM-DD` strings in the **workspace time zone** (`settings.workspace.defaultTimezone`; new workspaces default to
the host's zone). Timestamps are ISO-8601 UTC.

### The work ledger (`workLogs`)

An append-only record of facts: `Created task`, `Updated task`, `Moved task`, `Completed task`, `Reopened task`, `Assigned task`,
`Blocked/Unblocked task`, `Deleted task`, `Logged update`, `Raised blocker`. Each row has
`id, personId (the actor), actorUserId, assigneeId, taskId, projectId, taskKey/taskTitle/projectName (snapshots), action,
statusFrom, statusTo, summary, date, time, at, source, derived?`.

- It records **who did it** (not who the task belongs to) and **never records effort**. There is no `minutes` field.
- Rows keep snapshots of the task title and project name, so reports stay readable after a task or project is deleted.
- `derived: true` rows exist only for data created before ledger rows existed (see migrations): they are built from a task's
  recorded creation/completion date or an activity's timestamp and carry no invented clock time, status or effort.
- Reports are computed from this ledger (created/completed per period, activity counts) and from current task records (due
  dates, open/blocked/overdue now). History therefore does not change when a task is later edited, re-opened or deleted.

### Settings

`settings` is a tree with one branch per console section: `workspace`, `interface`, `localization`, `modules`, `workflows`,
`customFields`, `permissions`, `notifications`, `reports`, `exports`, `integrations`, `storage`, `security`, `audit`, plus
derived legacy flat keys (`language`, `theme`, …) that older clients read. Rules:

- Updates are **RFC 7386 merge patches** (`PUT /api/settings`): objects merge, arrays and scalars replace, `null` removes a key
  (resetting it to its default). A partial body never resets what it does not mention.
- Every load and every update runs `normalizeSettings` (`shared/settings.ts`): unknown time zones, themes, page sizes and
  language codes fall back to safe defaults so a bad value cannot break every route; role names are own-property checked; the
  Administrator role always keeps `manageSettings` and `manageUsers`.
- Built-in translations are **not** stored. Only entries that differ from the built-in catalog are persisted, so the store does
  not grow by ~100 KB the first time an administrator saves.
- Settings that are stored but not read by any code are listed in `src/lib/settings-status.ts` and shown as "Not applied yet".

## Relationships and delete semantics

References are checked on write (`400` for a missing project/person/team, `409` for duplicates).

| Delete         | Behaviour                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| project        | `409 HAS_DEPENDENTS` (with counts) while it has tasks, milestones or alerts. `?cascade=true` removes them too, after taking a **pre-delete-project** backup. |
| person         | Refused while they have a sign-in account. Otherwise their tasks become unassigned, projects lose the owner; ledger rows remain ("Former member").           |
| team           | Refused while people or projects belong to it.                                                                                                               |
| task           | Recorded in the ledger (`Deleted task`); alerts that referenced it lose the reference.                                                                       |
| user           | Their sessions end immediately; the last active administrator cannot be deleted, demoted or disabled.                                                        |
| workflow state | Refused while tasks use it. A _renamed_ state (same id, new label) carries its tasks and transitions along.                                                  |

## Persistence

**Load** (`DocumentStore.open`): create the directory (0700) → acquire `atlas.lock` → read and parse → refuse if the schema is
newer than this build understands → run pending migrations (after a **pre-migration** backup of the untouched file) →
`normalizeState` (structure only: missing collections, counters, defaults) → write back only if something changed.
A missing file creates an empty, unconfigured workspace **unless** backups exist, which stops with an error (an empty
workspace would reopen first-run setup).

**Write** (`commit(fn, {backupFirst?})`): `fn` mutates the in-memory state and appends its ledger/audit rows; then the state is
serialised, written to a temp file in the same directory, `fsync`ed, renamed over the store, and the directory is `fsync`ed.
Contract for `fn`: perform every check that can fail (`HttpError`) **before** the first mutation. An `HttpError` is assumed to
leave the state untouched; any other error and any failed write restores the last persisted state from its serialised
snapshot. There is no `await` between reading and writing state, so within one process writes are serialised.

Other behaviour: a daily snapshot is taken before the first write of a day; with `ATLAS_BACKUP_ON_WRITE=true` before every
write; `meta.writeCount` doubles as the **revision** clients poll (`GET /api/revision`); expensive diagnostics (checksum,
integrity, audit-chain) are memoised per revision; every 6 hours housekeeping prunes expired audit entries (and ledger rows if
`audit.workLogRetentionDays` is set).

## Migrations

| To      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.1.0` | Removes ledger rows named `wl_seed_*`/`wl_activity_*` (synthesised by older versions for tasks/activities that had no events, with made-up times and effort) and strips `minutes` from the remaining rows (fixed constants per action, never measured); adds `source`; freezes `task.key`; derives one `Created`/`Completed` ledger row per task and one row per activity from recorded dates (`derived: true`); resets role ranks to Viewer 1 … Administrator 4 (older stores recorded them inverted); drops frozen copies of the built-in translation catalog. Idempotent; covered by `tests/server/store.test.ts` using a real 3.0.0 store (`tests/fixtures/store-3.0.0.json`). |

New migrations go in `MIGRATIONS` (`server/migrations.ts`), bump `STORE_SCHEMA_VERSION` in `shared/settings.ts`, and need a
fixture-based test. Downgrades are not supported.

## Integrity

`npm run check:data` and `GET /api/system` report: collections are arrays; settings branches and workflow exist; the
Administrator role keeps `manageSettings`; duplicate ids, emails and project codes (errors); references to missing teams,
people, projects, tasks, and person profiles shared between accounts (warnings); legacy plain-text password fields (error); the
audit chain (`ok`, entries checked, first broken entry).

## Backups and restore

See `PRODUCTION.md` §6. In short: verified copies, retention per kind, `restore:data` validates the candidate first and keeps
the replaced file as a `pre-restore` backup; a damaged store is never replaced automatically.

## Standards for future changes

1. Validate at the boundary (`server/schemas.ts`); never persist unvalidated input.
2. Checks before mutation; mutation, ledger row and audit row in the same `commit`.
3. Record facts in the ledger; do not store derived or estimated numbers as if they were measurements.
4. Migrations are idempotent, preceded by a backup, and tested against a fixture.
5. No new setting without code that reads it (or an entry in `settings-status.ts`).
