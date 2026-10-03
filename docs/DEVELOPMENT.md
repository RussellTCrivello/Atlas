# Atlas Workspace Developer Guide

## Requirements

- Node.js `>=22.13.0` and npm.
- `node:sqlite` is available without an additional runtime flag from Node 22.13. It remains experimental across Node 22 and is a release candidate in Node 24, so keep Node/Electron compatibility explicit and test upgrades.
- The current Electron 44.5.1 release metadata identifies bundled Node 24.21.0. The built-in SQLite module is available in that runtime, but a packaged Electron launch still needs to be exercised on target platforms.

## Install and run

```bash
npm ci
npm run dev
```

`npm run app`, `npm run web`, and `npm run dev` run the same Express/Vite application. Production uses the prebuilt server and UI:

```bash
npm run build
npm run start
```

## Runtime architecture and modular boundaries

Atlas remains a single application process. `app.tsx` owns environment setup, SQLite connection/repository wiring, domain-service construction, Express middleware, API service composition, and server startup. Role-specific code lives under `src/server/`:

```text
src/server/
  database/   SQLite schema/migrations, connection pragmas, repository and backups
  domain/     settings, security, time, workspace/report and store rules
  http/       authentication/permission middleware and rate limiting
  routes/     grouped API route registrations
  shared/     validated, reusable primitives
```

Routes are grouped by responsibility (`system`, `users`, `directory`, `tasks-projects`, `activity-alerts`, and `preferences`) and registered through `src/server/routes/index.js`. Cross-cutting dependencies are injected through the route-service object in `app.tsx`; domain factories receive explicit dependencies rather than importing application globals. Client concerns are grouped by role: API and user-preference services, shared UI/filter/export/form/navigation components, access/settings/operational pages, workspace defaults, localization runtime, and pure helpers each live in focused modules under `src/`. `src/main.tsx` is the React composition and cross-page state root. Keep new logic in the closest responsibility module and wire it at the composition root. Avoid growing `app.tsx` with feature-specific route handlers or domain rules, and avoid reintroducing feature implementations into `src/main.tsx`.

Development mounts Vite middleware in the Node process. Production serves `dist/` static files from the same process. Electron imports `dist-desktop/app.mjs` into its main process and serves the same UI/API locally.

## SQL persistence and legacy data

SQLite at `data/atlas.sqlite` (or `ATLAS_DATA_DIR/atlas.sqlite`) is the authoritative server-side persistence source for workspace records, settings, audit/work history, and per-user preferences. Electron stores it under `<userData>/data/atlas.sqlite`. The former `atlas-store.json` is read only if no SQLite snapshot exists; successful import commits to SQLite and then moves the source to `data/legacy/`. It is not rewritten or consulted on subsequent starts. Per-user advanced filters and interface-language choices use the versioned `user_preferences` SQL table.

The browser has separate, non-authoritative local persistence for offline operation and local UI state: `src/api/offline-sync.js` uses IndexedDB for allowlisted per-user API response caches, offline session state, queued mutations, retries, and conflict recovery; saved table views in `src/components/table/RecordTable.jsx` remain in per-browser `localStorage` and are not synchronized between devices. The guarded one-time importer reads legacy `atlas-filter-*` localStorage keys and clears them only after the SQL endpoint confirms success. `sessionStorage` is used for the development service-worker cleanup/reload guard. Do not treat browser caches or saved table views as the SQL source of truth, and do not clear site data while offline edits are pending.

- SQLite DDL and schema versioning: `src/server/database/schema.js`.
- Node connection/pragmas: `src/server/database/connection.js`.
- Collection conversion, transactional upsert/delete, integrity and SQLite backups: `src/server/database/store-repository.js`.
- Per-user advanced-filter persistence: `src/server/database/user-preferences-repository.js` and `src/server/routes/preferences.routes.js`.
- Domain snapshot normalization and data-schema metadata: `src/server/domain/store.js`.
- Workspace/settings/security/time rules: `src/server/domain/`.
- Client organization: API in `src/api/`; shared UI grouped under `src/components/` (common, exports, filters, forms, navigation); access, settings, and operational pages in `src/pages/`; user preferences in `src/context/`; defaults/localization in `src/config/` and `src/i18n/`; pure filter and workspace helpers in `src/lib/`.

When adding a stored collection or a typed property:

1. Define the table, typed fields, indexes, and relationship constraints in `COLLECTIONS` in `src/server/database/schema.js`.
2. Add the migration needed to create or alter the SQL schema; increment `PRAGMA user_version` when the physical schema changes.
3. Add defaults/normalization/integrity rules in `src/server/domain/store.js` or the owning domain module.
4. Confirm `SqliteStoreRepository` round-trips the field, including null/empty/undefined distinctions and custom attributes.
5. Add tests for insert/update/delete, references, restart persistence, backup/restore, and legacy import where applicable.
6. Update database/API/operations documentation.

`persist()` normalizes the in-memory snapshot and writes all collections/settings/metadata within a SQLite transaction. The in-memory workspace remains the request/read model; do not introduce JSON file writes as application persistence. JSON remains appropriate for explicit JSON exports, settings import/export, and the one-time legacy import source.

Run a single application process per data directory. SQLite serializes transactions, but the application currently loads a whole workspace snapshot into memory; concurrent instances can each hold stale state and overwrite newer changes.

## Production first-run data

```bash
npm run init:production
```

This initializes a production-safe empty workspace in SQLite. It refuses to replace an existing database or legacy JSON source unless `ATLAS_FORCE_INIT_PRODUCTION=true` is deliberately set. Do not run it as a routine upgrade command. For existing data, back up and start the new build without resetting the store.

## Development sample data

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data
```

Demo accounts and sample data are development-only and appear only when explicitly allowed.

## Build outputs

```bash
npm run build
```

This runs:

1. `npm run build:web` — Vite client build into `dist/`.
2. `npm run build:server` — esbuild bundle of `app.tsx` plus internal server modules into `dist-desktop/app.mjs`.

## Project structure

```text
app.tsx                         Runtime composition root and Express startup
src/main.tsx                    React app composition and cross-page state root
src/api/                        Browser API client
src/components/                 Common, export, filter, form and navigation UI
src/pages/                      Access/setup, settings and operational features
src/config/                     Workspace defaults and role definitions
src/i18n/                       Localization catalog and runtime
src/context/                    User preference provider
src/lib/                        Filter, migration and workspace helpers
src/styles.css                  Local design system and responsive/print styles
src/desktop.js                  Browser/Electron display-mode helper
src/server/database/            SQLite schema, migration, connection, repository
src/server/domain/              Workspace, settings, security, time and store rules
src/server/http/                API middleware
src/server/routes/              API route groups and registration
src/server/shared/              Shared primitives
index.html                      Vite HTML entry
public/fonts/                   Local bundled fonts
public/sw.js                    Static-shell service worker
electron/main.cjs                Electron main process
electron/preload.cjs             Safe desktop metadata bridge
data/atlas.sqlite                Local runtime database (ignored by Git)
data/backups/                    SQLite backups
data/legacy/                     Archived one-time JSON import source
docs/                            Product, developer and operations documentation
```

## Coding standards

### General

- Keep the current single-process app architecture unless product direction changes.
- Do not add external UI/CDN dependencies for core rendering.
- Keep fonts and visual assets local.
- Keep public API responses free of password hashes and sensitive session data.
- Keep production defaults free of demo/test records unless explicitly enabled.

### Server/API

- Add endpoints to the appropriate module under `src/server/routes/`, then register the module in `src/server/routes/index.js`.
- Use `requireUser` on authenticated routes and the narrowest applicable permission middleware/check on sensitive or mutating routes.
- Use `sendError(res, status, message)` for consistent JSON errors.
- Use domain services for validation/mapping and `persist()` after state changes; do not write store JSON files.
- Update `validateStoreState()` and SQL foreign keys/indexes for new relationships.
- Preserve existing ownership/privacy semantics unless the authorization model is intentionally changed and documented.

### UI and CSS

- Put reusable controls in `src/components/` and feature-specific screens in `src/pages/`; keep `src/main.tsx` focused on app composition and shared runtime state.
- Prefer tokens and existing classes in `src/styles.css` over one-off styles.
- Add role-aware controls and read-only states; server authorization remains authoritative.
- Keep keyboard focus visible. Do not import external stylesheets/fonts.

## Validation workflow

Run before handoff:

```bash
npm run build
git diff --check
TEST_PORT=5193 node scripts/final-validation.mjs
```

The acceptance script uses only `.audit-test-data/final-validation-data` and `.audit-test-data/legacy-json-import-data`; it validates those paths before cleanup. It exercises production API flows, database integrity, backup/restore, restart persistence, schema migration, the one-time legacy JSON import/archive, record preservation, role checks, and report behavior. Do not point it at a live data directory.

Manual isolated smoke test:

```bash
ATLAS_DATA_DIR="$(mktemp -d)" NODE_ENV=production PORT=5185 node dist-desktop/app.mjs
```

Check `GET /api/health`, `GET /api/setup/status`, complete `/api/setup`, and verify the resulting `atlas.sqlite` persists data across a restart. Do not run `npm run init:production` against a real or populated store.

## Desktop development

```bash
npm run desktop
```

Electron behavior:

- Sets `NODE_ENV=production` and chooses a local port.
- Sets `ATLAS_ROOT`, `ATLAS_STATIC_DIR`, and `ATLAS_DATA_DIR`.
- Imports `dist-desktop/app.mjs` into Electron's main process.
- Uses Electron's bundled Node runtime and its `node:sqlite` module.
- Loads `http://127.0.0.1:<port>` in a BrowserWindow with context isolation and no renderer Node integration.

The declared Electron release bundles Node 24.21.0, which contains `node:sqlite`; the actual Electron binary was not available in this validation environment, so packaged launch/SQLite access remains an explicit release check.

## Common issues

### `node:sqlite` is not available

Use Node.js `>=22.13.0`. Earlier Node 22 releases require the experimental SQLite flag; this application does not add the flag automatically.

### `vite: not found`

Run `npm ci`.

### Cannot sign in

- Check `/api/setup/status`.
- If `configured` is false, complete first-run setup.
- If configured, ask an administrator to create or activate your account.

### Reports are empty

Activity reports use task and activity evidence from work logs/activity rows. Create or update tasks or log activity to generate entries.
