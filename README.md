# Atlas Workspace

Atlas is a local-first engineering operations workspace with professional navigation, drag-and-drop task boards, advanced filters, live dashboards, alerts, and customizable reports.

## Run locally

Use Node.js `>=22.13.0` (the built-in `node:sqlite` module is available without an extra runtime flag from Node 22.13 onward):

```bash
npm ci
npm run dev
```

Open the local app and complete first-run setup. Production mode does not expose bundled test credentials. For development-only sample data:

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data
```

## Architecture and persistence

Atlas stays a single Node.js application: Express serves the API and React UI, Vite is mounted in development, and Electron runs the same server bundle. Server responsibilities are organized by role under `src/server/`:

- `database/` — SQLite schema/migrations, connection setup, relational repository, backup and integrity operations.
- `routes/` — API routes grouped by system, users, directory, projects/tasks, and activity/alerts.
- `domain/` — settings, workspace/report mapping, security, time, and store normalization rules.
- `http/` — authentication/permission middleware and request rate limiting.
- `shared/` — validated primitive helpers shared across services.

All runtime application persistence is SQLite. The default database is `data/atlas.sqlite`; Electron uses `<userData>/data/atlas.sqlite`. Settings, records, metadata, counters, and audit/work logs are stored in SQLite tables and written transactionally. The old `atlas-store.json` is read only when no SQLite snapshot exists; after a successful import it is archived under `data/legacy/` and is never the runtime source of truth. SQLite backups are stored under `data/backups/`.

`node:sqlite` is built into supported Node runtimes, so no external/native SQLite dependency is installed. The API is still experimental in Node 22 and release-candidate in Node 24; the Electron 44.5.1 release bundles Node 24.21.0, but launching a packaged Electron build remains a separate release check. Run one Atlas process per data directory because each process keeps an in-memory workspace snapshot and concurrent application instances could overwrite each other's changes.

## Included functionality

- Local fonts and assets; no remote UI fonts, CSS CDN, or core UI dependencies.
- PWA manifest, icon, and service worker with static shell caching.
- Projects, teams, people, tasks, milestones, activity updates, alerts, and reports. Project cards open a complete, searchable task portfolio loaded from SQLite.
- An SQL-backed report studio builds CSV, Excel, JSON, PDF, and standalone print output from allowlisted database fields, including configured visible custom fields, with field selection, locale-aware formatting, grouping, sorting, branded templates, and export audit logging.
- Role-based access control enforced by the API, plus role-aware interface controls.
- Production first-run setup with no sample users or default credentials unless demo mode is explicitly enabled.
- Salted password hashing, HTTP-only sessions, SQLite integrity checks, and timestamped SQLite backups.

## Useful scripts

```bash
npm run build           # production web + server builds
npm run start           # run the built production application
npm run preview         # build, then start production locally
npm run init:production # initialize a fresh database only; refuses existing data by default
npm run reset:data      # development only: restore seeded demo data
npm run backup:data     # create a timestamped SQLite backup
npm run desktop         # build and launch Electron
npm run desktop:dir     # build an unpacked desktop directory
npm run desktop:pack    # build platform installer packages
```

**Do not run `npm run init:production` as a normal upgrade command.** It initializes an empty production workspace and intentionally replaces existing data only when the explicit `ATLAS_FORCE_INIT_PRODUCTION=true` override is set. Back up before any migration or recovery operation.

## Documentation

Complete documentation is maintained in [`docs/`](docs/README.md):

- Complete manual: [`docs/ATLAS_WORKSPACE_MANUAL.md`](docs/ATLAS_WORKSPACE_MANUAL.md)
- Design standards: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- SQLite architecture and legacy import: [`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md)
- API reference: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
- Developer guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Build/deployment: [`docs/BUILD_AND_DEPLOYMENT.md`](docs/BUILD_AND_DEPLOYMENT.md)
- Operations runbook: [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md)
- Functionality reference: [`docs/FUNCTIONALITY_REFERENCE.md`](docs/FUNCTIONALITY_REFERENCE.md)
- Configuration/i18n/extensibility: [`docs/CONFIGURATION_I18N_EXTENSIBILITY.md`](docs/CONFIGURATION_I18N_EXTENSIBILITY.md)
- Final acceptance report: [`docs/FINAL_ACCEPTANCE_REPORT.md`](docs/FINAL_ACCEPTANCE_REPORT.md)
