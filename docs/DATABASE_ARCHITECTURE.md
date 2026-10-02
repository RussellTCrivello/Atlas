# Atlas Workspace Database Architecture

## Architecture summary

Atlas uses an embedded relational SQLite database for **all runtime persistence**. The application is one Node.js process with an in-memory workspace view, but every persisted application change is committed to SQLite; JSON is only used for explicit import/export formats and a one-time legacy-store import.

| Concern | Implementation |
| --- | --- |
| Runtime engine | SQLite through Node's built-in `node:sqlite` / `DatabaseSync` |
| Web/local database | `<ATLAS_DATA_DIR>/atlas.sqlite`, default `data/atlas.sqlite` |
| Electron database | `<userData>/data/atlas.sqlite` |
| Physical database schema | `PRAGMA user_version = 2`, managed in `src/server/database/schema.js` |
| Domain data version | `STORE_SCHEMA_VERSION = 4.0.0`, normalized by `src/server/domain/store.js` |
| Write model | In-memory workspace snapshot persisted transactionally across relational tables |
| Backups | Standalone SQLite snapshots created with `VACUUM INTO` under `data/backups/` |
| Legacy source | `atlas-store.json` is read once only when no SQLite snapshot exists; archived after successful import |

Atlas does not connect to an external database service. Keep one application process per data directory: SQLite protects each database transaction, but separate Atlas processes keep independent in-memory snapshots and could overwrite newer state with stale snapshots.

## Runtime and driver compatibility

`node:sqlite` is available without an extra runtime flag beginning with Node 22.13.0, so the package now requires Node `>=22.13.0`. It remains experimental in Node 22 and a release candidate in Node 24; a warning on Node 22 is expected. Electron 44.5.1 release metadata reports bundled Node 24.21.0, which includes `node:sqlite` ([Electron release metadata](https://releases.electronjs.org/release/v44.5.1), [Node SQLite API](https://nodejs.org/api/sqlite.html)). The Electron binary could not be downloaded in the audit environment, so a packaged app launch against SQLite is still a release check, not a completed runtime test.

`DatabaseSync` runs statements synchronously on the event loop. The present workload is suitable for the local/single-process operating model; large writes or high concurrency may block request handling. Reassess a different driver/deployment architecture before high-volume or multi-instance use.

## Source layout

- `src/server/database/schema.js` — table definitions, indexes, foreign keys, and physical migrations.
- `src/server/database/connection.js` — SQLite connection, durability/security pragmas, private directory setup.
- `src/server/database/store-repository.js` — record conversion, snapshot reads/writes, backup, integrity, and counts.
- `src/server/database/user-preferences-repository.js` — per-user SQL preferences, currently saved advanced filters.
- `src/server/domain/store.js` — default/legacy normalization, generated seed data, integrity validation, and checksums.
- `src/server/domain/` — settings, workspace mapping/report logic, security, and time services.
- `src/server/routes/` — role-grouped API route modules, including validated saved-filter preferences.
- Client modules under `src/api/`, `src/components/`, `src/pages/`, `src/config/`, `src/i18n/`, `src/context/`, and `src/lib/` — API, shared UI, feature pages, workspace defaults, localization, user preferences, and filter/workspace helpers. `src/main.tsx` is the client composition/state root.

## Schema and tables

The physical schema is migrated transactionally and marked with SQLite's `user_version`. Schema version 1 creates the workspace, metadata, settings, counters, and migration-history tables. Schema version 2 adds:

- `user_preferences` — one SQL row per account for validated saved-filter conditions, with a foreign key that cascades when the account is deleted.

The relational workspace tables are:

- `teams`, `people`, `projects`, `tasks`, `milestones`, `activities`, `alerts`
- `users`, `work_logs`, `audit_logs`
- `workspace_settings` — the normalized workspace settings document stored as validated JSON text in SQL
- `application_meta` — store metadata and configured status
- `id_counters` — next project/task numeric identifiers
- `schema_migrations` — applied physical schema version/name/time

Settings remain JSON-shaped to support structured, backward-compatible configuration, but the persisted value is inside SQLite with `json_valid` constraints. Entity collections use typed SQL columns for known fields. Each collection table also stores:

- `id` as a primary key, with `id_type` to preserve numeric versus string IDs.
- `ordinal` to preserve source collection order.
- `attributes_json` for unrecognized/forward-compatible properties.
- `present_json` and `field_states_json` to round-trip omitted, `undefined`, `null`, and empty-reference values.
- `row_hash` to avoid unnecessary row updates when records have not changed.

Known JSON/custom-field properties are stored in JSON-validated SQL columns. Boolean, numeric, required text/JSON, and identifier fields are checked while converting records; tables use SQLite `STRICT` mode. Entity updates/deletes are written as a transaction, not as independent JSON files.

### Relationships and constraints

- `teams 1 ── * people` — team deletion is restricted while referenced.
- `teams 1 ── * projects` — team deletion is restricted while referenced.
- `people 1 ── * users` — profile deletion is restricted while referenced.
- `users 1 ── 0..1 user_preferences` — each account has at most one saved-filter preference row; deleting the account cascades its preferences.
- `people 1 ── * projects` — owner deletion is restricted while referenced.
- `people 1 ── * tasks` — assignee deletion is restricted while referenced.
- `people 1 ── * activities` — person deletion is restricted while referenced.
- `projects 1 ── * tasks/milestones/alerts` — task/milestone/alert references cascade when their project is removed; normal API validation still prevents unsafe removal.
- `tasks 1 ── * alerts` — task-linked alerts cascade when a task is removed.
- `work_logs` and `audit_logs` retain historical identifiers without foreign keys so history can survive entity removal.

Foreign keys are enabled on every connection and checked before commit with `PRAGMA foreign_key_check`. Additional application-level validation appears in `/api/system`.

Unique indexes enforce non-empty, case-insensitive team names, person/user emails, and project codes. The repository temporarily clears these unique values inside the same write transaction before updating a full snapshot, allowing safe in-transaction swaps without violating uniqueness midway through a multi-record update.

## Persistence and startup

### Normal SQLite startup

1. Ensure the data directory exists with owner-only permissions on POSIX systems.
2. Open SQLite and configure `foreign_keys=ON`, `busy_timeout`, WAL journaling, `synchronous=FULL`, memory temp storage, and `trusted_schema=OFF`.
3. Run the physical schema migration if needed.
4. Load the singleton settings/metadata/counters and entity tables into the in-memory workspace snapshot.
5. Normalize application-level defaults and compatibility fields, then write the normalized snapshot back to SQLite without incrementing the write count.

After an authenticated user loads the workspace, Atlas checks the former browser keys `atlas-filter-projects`, `atlas-filter-tasks`, `atlas-filter-people`, `atlas-filter-activity`, and `atlas-filter-alerts`. Valid conditions are imported into that account's `user_preferences` row only when the SQL preference for that filter key does not already exist. The browser keys are removed only after the server confirms the SQL preferences were read or saved. This is a one-time compatibility import; all later filter reads/writes use SQLite. When the same browser is shared by multiple accounts during the upgrade, the first account that completes this import receives the legacy browser-wide filters; existing SQL values always take precedence.

### One-time legacy JSON import

If the SQLite database has no workspace snapshot and `<dataDir>/atlas-store.json` exists:

1. Parse the old document.
2. Normalize it using the current domain rules.
3. Persist the complete result to SQLite in one database transaction.
4. Only after the SQLite commit succeeds, move the source to `data/legacy/atlas-store-imported-<timestamp>.json`.

Subsequent startup reads only SQLite. If the legacy source is invalid JSON, it is moved to a timestamped `atlas-store-corrupt-<timestamp>.json` path and Atlas initializes an empty production workspace; restore/inspect the moved source before using the new workspace if its content may matter. An archive failure is logged and leaves the legacy JSON file in place, but a populated SQLite database takes precedence on later startup.

Legacy JSON backups under `data/backups/` are not active databases. To import one, stop Atlas, copy the chosen legacy snapshot to an empty data directory as `atlas-store.json`, and start Atlas there; verify the resulting SQLite database and archived source before replacing any active data.

## Transaction and write flow

Every `persist()` operation:

1. Normalizes the current workspace view and updates metadata/write count.
2. Optionally creates a backup of the previously committed database if `ATLAS_BACKUP_ON_WRITE=true`.
3. Starts `BEGIN IMMEDIATE`.
4. Upserts typed rows and forward-compatible attributes in dependency order; removes missing records in reverse order.
5. Writes settings, metadata, configured state, and counters.
6. Runs a foreign-key check and commits; errors roll back the entire write.

This makes one application-level snapshot write transactional. If SQLite rejects a write, the request fails and the in-memory workspace is restored from the last committed SQL snapshot, preventing a failed mutation from leaking into subsequent reads or writes. Saved-filter preferences use a separate parameterized `INSERT ... ON CONFLICT` against `user_preferences`, so changing a user's filters does not rewrite the workspace snapshot. The workspace design currently rewrites/upserts the complete in-memory snapshot rather than issuing narrowly scoped SQL for each domain request. Public reads/reporting are built from that in-memory view, not independent SQL queries.

## Backup and restore

Create a backup:

```bash
npm run backup:data
```

Backups are named `atlas-db-<timestamp>-<reason>.sqlite` under `<ATLAS_DATA_DIR>/backups/`. The database is snapshotted with `VACUUM INTO`, chmodded to owner read/write on POSIX, and pruned to the configured retention count (`ATLAS_BACKUP_RETENTION`, default 25, clamped to 3–100). With `ATLAS_BACKUP_ON_WRITE=true`, a backup is made before each persisted write.

Restore a SQLite backup safely:

1. Stop Atlas completely.
2. Preserve a copy of the current `atlas.sqlite` and any `atlas.sqlite-wal` / `atlas.sqlite-shm` sidecars.
3. Copy the chosen standalone `.sqlite` backup to the active database path as `atlas.sqlite`.
4. Remove stale `atlas.sqlite-wal` and `atlas.sqlite-shm` sidecars only after the app is stopped and the old files have been preserved.
5. Start Atlas and verify `/api/system` integrity and expected record counts.

Never copy a database over a running application. Keep at least one backup outside the machine/user profile that contains the live database if hardware loss is in scope. SQLite is not encrypted at rest; protect the data directory and backup destination using OS permissions and storage encryption appropriate to the deployment.

## CLI operations

- `npm run init:production` initializes an empty first-run database. It refuses an existing SQLite database or legacy JSON source unless the explicitly destructive `ATLAS_FORCE_INIT_PRODUCTION=true` override is set.
- `npm run reset:data` replaces the store with demo data only when `ATLAS_ALLOW_DEMO_DATA=true` is set.
- `npm run backup:data` loads/imports the store if necessary, then creates a manual SQLite backup.

These commands are not upgrade steps. Back up existing data before deploying a new build; normal startup runs supported physical migrations.

## Integrity and diagnostics

`GET /api/runtime-config` reports SQLite engine version, physical schema version, data schema version, and journal mode. An administrator can inspect `GET /api/system` / Settings → System store, which reports:

- SQLite integrity (`PRAGMA integrity_check`) and foreign-key checks.
- Domain integrity errors/warnings and checksum.
- Data/schema metadata, table counts, recent backups, and sample/live profile counts.

The validation command `TEST_PORT=5193 node scripts/final-validation.mjs` exercises production CRUD, permissions, reporting, backup/restore, restarts, schema normalization, one-time JSON import and archival, and explicit legacy content preservation in isolated directories under `.audit-test-data/`.

## Schema evolution rules

For a new property/entity:

1. Add it to `COLLECTIONS` with the correct SQLite type, indexes, uniqueness, and references.
2. Add a physical migration and increment SQLite `user_version` when tables/indexes/constraints change. Never mutate an already-deployed schema version in place.
3. Add/update domain defaults and normalization as needed; bump `STORE_SCHEMA_VERSION` for data-shape changes.
4. Preserve legacy IDs, field values, and collection ordering where valid; only discard documented generated/invalid data.
5. Verify export/import behavior, foreign-key handling, backup/restore, and old-schema fixtures.
6. Update this architecture document, API docs, and operational restore instructions.

## Current boundaries and limitations

- One Atlas process per data directory; no multi-instance coordination, distributed database, or horizontal scaling.
- Synchronous `DatabaseSync` and full-snapshot persistence can block the event loop for large workspaces.
- `node:sqlite` is experimental on Node 22 and release-candidate on Node 24. Electron release metadata is compatible, but a packaged Electron run remains unverified.
- No SQLite encryption-at-rest layer; use filesystem/OS encryption and protect backups.
- Authentication sessions remain in memory; only application workspace data is persisted in SQL.
- JSON settings and custom-field values are intentionally kept as JSON-shaped values in SQLite columns; this is not a JSON-file persistence fallback.
