# Atlas Workspace Complete Manual

## 1. Product definition

Atlas Workspace is a production-oriented, local-first operations application. It combines project management, task workflow, people/team context, daily activity, alerts, reporting, export/print, settings, access control, and desktop deployment in one Node.js/TSX application.

Atlas is intentionally not split into separate client and server applications. The same Node process serves:

- React/TSX interface
- API routes
- local fonts/assets
- data persistence
- reporting data
- production static build
- Electron desktop runtime

## 2. Production posture

Production mode is designed for real-world first use:

- No bundled production credentials.
- No sample users or sample data after `npm run init:production`.
- First launch requires administrator setup.
- Passwords are stored as salted `scrypt` hashes.
- Sessions use HTTP-only cookies.
- Backend routes enforce roles and permissions.
- Core UI assets are local.
- Database metadata, schema version, backups, and integrity are visible to administrators.

## 3. Requirements

- Node.js `>=22.13.0` for the built-in SQLite runtime and Electron 44.
- npm.
- Modern Chromium-based browser for web preview.
- Supported desktop build hosts for Electron packaging targets.

## 4. Installation

```bash
npm install
```

## 5. First-run production start

```bash
npm run init:production
npm run build
npm run start
```

Then open Atlas and complete first-run setup.

## 6. Development start

```bash
npm run app
```

This runs `app.tsx` directly through `tsx`, with Vite middleware inside the same Express application.

## 7. Development sample data

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data
```

Only use this for development and demos. Production should use `npm run init:production`.

## 8. Core scripts

| Script | Description |
| --- | --- |
| `npm run app` | Start single app in development. |
| `npm run build` | Build web assets and bundled server. |
| `npm run start` | Run production server from `dist-desktop/app.mjs`. |
| `npm run preview` | Build then start production server. |
| `npm run init:production` | Reset data to production first-run. |
| `npm run reset:data` | Reset to development demo data. |
| `npm run backup:data` | Create data-store backup. |
| `npm run desktop` | Build and launch Electron. |
| `npm run desktop:dir` | Build unpacked desktop app. |
| `npm run desktop:pack` | Build desktop packages/installers. |

## 9. Environment variables

See [Build and Deployment Guide](BUILD_AND_DEPLOYMENT.md) for the full environment table. The most important variables are:

- `NODE_ENV`
- `PORT`
- `ATLAS_HOST`
- `ATLAS_DATA_DIR`
- `ATLAS_STATIC_DIR`
- `ATLAS_COOKIE_SECURE`
- `ATLAS_ALLOW_DEMO_DATA`
- `ATLAS_BACKUP_RETENTION`
- `ATLAS_BACKUP_ON_WRITE`

## 10. Application architecture

### Runtime layers

1. `app.tsx` creates the Express application.
2. API routes use role-grouped modules and domain services over an in-memory workspace view persisted to SQLite.
3. Development mode mounts Vite middleware.
4. Production mode serves `dist/` static assets.
5. Electron imports `dist-desktop/app.mjs` and loads the local app.

### Why one app

The single app design reduces deployment complexity, supports desktop packaging, keeps local assets reliable, and satisfies local-first operation.

## 11. Database architecture

Atlas uses an embedded, relational SQLite database for all runtime persistence:

- Database: `data/atlas.sqlite` (Electron: `<userData>/data/atlas.sqlite`)
- Physical SQLite schema: version 2; domain store schema: `4.0.0`
- Snapshot writes: SQLite transactions with foreign-key validation
- Integrity checks: SQLite and domain-level checks
- Backup command: `npm run backup:data` creates `.sqlite` backups
- Legacy JSON: one-time import into SQLite, then archived under `data/legacy/`

See [Database Architecture](DATABASE_ARCHITECTURE.md) for complete schema details.

## 12. Design system

Atlas uses a local, tokenized design system:

- Local Atlas Sans and Atlas Display fonts.
- CSS custom properties for color, spacing, and elevation.
- Sidebar/topbar shell.
- Cards, panels, tables, status pills, modals, command search, report exporters, and settings tiles.
- Role-aware controls.
- Accessible focus states.
- Print/export-aware report surfaces.

See [Design System and Interface Standards](DESIGN_SYSTEM.md).

## 13. Security model

### Authentication

- Users authenticate with email/password.
- Passwords are salted and hashed with `scrypt`.
- Sessions are stored server-side in memory and referenced by an HTTP-only cookie.

### Authorization

Roles map to permission lists. Backend route middleware enforces permissions before mutations or sensitive reads.

### Production defaults

- No default credentials.
- No demo credentials unless explicitly enabled by environment.
- Production binds to `127.0.0.1` by default.
- Set `ATLAS_COOKIE_SECURE=true` behind HTTPS.

## 14. Roles

| Role | Typical use |
| --- | --- |
| Administrator | Workspace owner, access control, settings, all data. |
| Manager | Operational management, projects, people, tasks, alerts, reports. |
| Developer | Own work, task movement, activity updates, reports/exports. |
| Viewer | Read-only reporting and exports. |

## 15. Screens

### Setup

Creates initial administrator and workspace identity.

### Login

Production login for administrator-created accounts.

### Overview

Command center for active projects, tasks, attention items, pulse, blockers, and upcoming work.

### Projects

Manage project records, health, owners, team, milestones, deadlines, and progress.

### My Work

Drag-and-drop task workflow across To do, In progress, Review, Testing, Done.

### People

Manage people, capacity, teams, focus, and work status.

### Activity

Log daily updates, blockers, and upcoming commitments.

### Reports

General delivery reporting and user activity intelligence.

### Alerts

Track and resolve risks, blockers, overdue items, and informational alerts.

### Settings

Workspace identity, interface settings, export defaults, navigation access, access control, local assets, and system store integrity.

## 16. Reporting

### General reporting periods

- Daily
- Weekly
- Monthly
- Quarterly
- Yearly

### User activity periods

- Daily
- Weekly
- Monthly

### User activity report evidence

Each activity report row includes:

- person
- role
- project
- project code
- task id
- task title
- action
- status movement
- summary
- minutes
- source
- date/time

## 17. Exports and print

Reports and tables support:

- CSV
- Excel
- JSON
- PDF
- Print
- Column customization
- Title customization
- Orientation
- Margins
- Print templates

## 18. Backup and restore

Backup:

```bash
npm run backup:data
```

Restore:

1. Stop Atlas completely.
2. Preserve the active `atlas.sqlite` and any `atlas.sqlite-wal` / `atlas.sqlite-shm` files.
3. Copy the selected standalone `.sqlite` backup to the active path as `data/atlas.sqlite`.
4. Remove stale WAL/SHM sidecars only while Atlas remains stopped.
5. Restart Atlas and validate Settings → System store.

For full recovery details and legacy JSON import behavior, see [Database Architecture](DATABASE_ARCHITECTURE.md).

## 19. Build and desktop packaging

Production build:

```bash
npm run build
```

Desktop validation:

```bash
npm run desktop:dir
```

Desktop packages:

```bash
npm run desktop:pack
```

Configured targets:

- Windows NSIS and portable
- Linux AppImage and DEB
- macOS DMG

## 20. API

The API is documented in [API Reference](API_REFERENCE.md). Major groups:

- health/runtime/setup
- auth
- bootstrap
- reports
- settings/system
- tasks
- projects
- people/teams
- milestones
- activity
- alerts
- users

## 21. Development workflow

Recommended sequence:

1. Update data model and docs.
2. Update server normalization and integrity checks.
3. Add API route with permissions.
4. Add UI with design-system classes.
5. Add report/export integration if needed.
6. Build and smoke test.

See [Developer Guide](DEVELOPMENT.md).

## 22. Validation commands

```bash
npm run build
npm audit --omit=dev
npm audit
npm run init:production
npm run desktop:dir
```

Production smoke test:

1. Start `NODE_ENV=production` with temporary `ATLAS_DATA_DIR`.
2. Check `/api/health`.
3. Check `/api/setup/status`.
4. Create admin through setup.
5. Create team/person/project/task.
6. Complete task.
7. Verify activity report rows.

## 23. Documentation map

- Product/functionality: [Functionality Reference](FUNCTIONALITY_REFERENCE.md)
- Design: [Design System](DESIGN_SYSTEM.md)
- Database: [Database Architecture](DATABASE_ARCHITECTURE.md)
- API: [API Reference](API_REFERENCE.md)
- Development: [Developer Guide](DEVELOPMENT.md)
- Build/deploy: [Build and Deployment](BUILD_AND_DEPLOYMENT.md)
- Operations: [Operations Runbook](OPERATIONS_RUNBOOK.md)


## 24. Configurable platform administration

Atlas now includes a Settings-managed platform configuration architecture covering workspace identity, UI composition, localization, translations, RTL/LTR behavior, modules, workflows, roles, custom fields, reports, exports, notifications, integrations, storage, security, audit, and maintenance. See [Configuration, Internationalization, and Extensibility](CONFIGURATION_I18N_EXTENSIBILITY.md).
