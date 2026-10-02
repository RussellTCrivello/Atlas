# Atlas Workspace — Production & Desktop Deployment Guide

Atlas is now prepared as one production application: a Node.js TSX app that serves the UI, API routes, local assets, report generation, and schema-versioned embedded data store from a single process. The default data store is production first-run setup: no sample records, no demo accounts, and no exposed test credentials. The Electron shell starts that same application internally for desktop deployment.

## Production build

```bash
# Node.js 22.12+ is required for the current Electron production toolchain.
npm install
npm run init:production
npm run build
```

This creates:

- `dist/` — optimized React/TSX interface and local assets.
- `dist-desktop/app.mjs` — bundled Node application entry used by Electron.

Validation also completed with zero npm audit findings for both runtime dependencies and the full installed toolchain.

## Run production server

```bash
npm run start
```

Health check:

```bash
curl http://localhost:5173/api/health
```

## Desktop deployment

Development desktop shell:

```bash
npm run desktop
```

Build an unpacked desktop directory for validation:

```bash
npm run desktop:dir
```

Build desktop installers/packages:

```bash
npm run desktop:pack
```

Configured targets:

- Windows: NSIS installer and portable build.
- Linux: AppImage and DEB.
- macOS: DMG target.

Desktop runtime behavior:

- Electron starts the same Atlas Node application internally in production mode.
- Electron is configured on the current patched release line used by this package lock.
- The app binds to a private local port and loads it in a native window.
- Desktop data is stored in Electron `userData` under a dedicated `data` directory.
- Production UI assets are loaded from the packaged `dist/` directory.
- No remote fonts or CDN UI assets are required.

## Activity and task performance reporting

Atlas now exposes detailed evidence-backed activity reporting by user or aggregate scope.

### API

```txt
GET /api/reports/activity/daily?userId=all
GET /api/reports/activity/weekly?userId=all
GET /api/reports/activity/monthly?userId=all
GET /api/reports/activity/weekly?userId=p1
```

`userId=all` generates aggregate reports for all users. Passing a person id generates a specific user report.

Each report includes:

- `totals` — tasks touched, completed tasks, active users, projects, updates, blockers, minutes.
- `series` — day/week/month trend buckets.
- `users` — per-user summary.
- `projects` — project contribution matrix.
- `rows` — detailed evidence ledger with date, person, project, task id, task title, action, status, minutes, and source.

### Interface

Open **Reports → User activity intelligence** to generate:

- daily user report
- weekly user report
- monthly user report
- daily all-user aggregate
- weekly all-user aggregate
- monthly all-user aggregate

Every table supports export and print customization through the existing export panel:

- PDF
- Excel
- CSV
- JSON
- custom title
- selected columns
- orientation
- print margins
- print templates

## Production identity and security

Production defaults:

- No demo/test accounts are created unless `ATLAS_ALLOW_DEMO_DATA=true` is explicitly set.
- First launch requires administrator setup.
- Local account passwords are stored as salted `scrypt` hashes.
- Session cookies are HTTP-only. Set `ATLAS_COOKIE_SECURE=true` when serving behind HTTPS.
- In production, Atlas binds to `127.0.0.1` by default. Set `ATLAS_HOST=0.0.0.0` only when intentionally exposing it behind a trusted reverse proxy.
- `/api/health` is available for deployment checks.
- The embedded store uses schema metadata, normalization, atomic temp-file writes, integrity checks, timestamped backups through `npm run backup:data`, and the Settings-managed platform configuration model.

## Security and permissions

Roles are enforced in both the interface and backend routes:

- Administrator — full settings, user management, reports, exports, and operational control.
- Manager — project, people, alert, task, report, and export management.
- Developer — task progress, daily updates, reports, and exports.
- Viewer — read-only reports and exports.

The server returns `403 Forbidden` for unauthorized mutations.

## Local assets

Atlas uses bundled local fonts and assets only:

- `public/fonts/AtlasSans-Regular.ttf`
- `public/fonts/AtlasSans-Bold.ttf`
- `public/fonts/AtlasDisplay-Bold.ttf`
- `public/atlas-icon.svg`
- `public/manifest.webmanifest`
- `public/sw.js`

## Validation commands used

```bash
npm run init:production
npm run build
npm run start
npm audit --omit=dev
npm audit
npx electron-builder --dir --linux dir --config.directories.output=/tmp/atlas-release-config-final2
```

Validated endpoint and production-flow checks:

```bash
/api/health
/api/setup/status
/api/bootstrap
/api/reports/activity/daily?userId=<personId>
/api/reports/activity/weekly?userId=all
/api/reports/activity/monthly?userId=<personId>
```

A production first-run smoke test created a new administrator, team, person, project, task, completion event, and daily user activity report in a temporary clean data directory. The workspace data store was then reset with `npm run init:production` so the checked-in workspace opens to first-run setup rather than seeded demo data.


## Complete documentation

The full production documentation set is in [`docs/`](docs/README.md):

- [`docs/ATLAS_WORKSPACE_MANUAL.md`](docs/ATLAS_WORKSPACE_MANUAL.md)
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- [`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md)
- [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- [`docs/BUILD_AND_DEPLOYMENT.md`](docs/BUILD_AND_DEPLOYMENT.md)
- [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md)
- [`docs/FUNCTIONALITY_REFERENCE.md`](docs/FUNCTIONALITY_REFERENCE.md)
- [`docs/CONFIGURATION_I18N_EXTENSIBILITY.md`](docs/CONFIGURATION_I18N_EXTENSIBILITY.md)

- `docs/CONFIGURATION_SETUP_ADVANCEMENTS.md` — latest advanced setup and full configuration console improvements.
- `docs/FIELD_ENTRY_CONFIGURATION_FIX.md` — field-entry stability, service-worker cache refresh, and configuration layout polish.
- `docs/FULL_INTERFACE_I18N_UPDATE.md` — multilingual setup/application UI behavior, RTL support, and cache update notes.
- `docs/TRANSLATION_SYSTEM_ARCHITECTURE.md` — production translation system architecture and integration guidance.
