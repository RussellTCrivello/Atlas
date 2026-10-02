# Atlas Workspace Build and Deployment Guide

## Required runtime

Use Node.js `>=22.13.0` for production runtime, build, and packaging. This is the first Node 22 release where `node:sqlite` is available without an extra runtime flag. The API remains experimental in Node 22 and release-candidate in Node 24; Electron 44.5.1 bundles Node 24.21.0, but the packaged application still needs a launch/SQLite smoke test on target platforms. Top-level dependencies are pinned to exact versions in `package.json` and `package-lock.json`; use `npm ci` for reproducible installs. `npm run build` builds the web client and Node server bundle, but does not download/package Electron.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run app` | Run the single Node.js TSX app in development mode. |
| `npm run web` | Alias for `npm run app`. |
| `npm run dev` | Alias for `npm run app`. |
| `npm run build:web` | Vite production build into `dist/`. |
| `npm run build:server` | Bundle `app.tsx` into `dist-desktop/app.mjs`. |
| `npm run build` | Build both web and server artifacts. |
| `npm run start` | Run built production app with `NODE_ENV=production`. |
| `npm run preview` | Build, then start production app. |
| `npm run desktop` | Build and launch Electron. |
| `npm run desktop:dir` | Build an unpacked desktop directory. |
| `npm run desktop:pack` | Build desktop installers/packages. |
| `npm run init:production` | Initialize a fresh production store; refuses an existing store unless `ATLAS_FORCE_INIT_PRODUCTION=true` is set. |
| `npm run reset:data` | Development-only seeded demo data reset. |
| `npm run backup:data` | Create a timestamped data-store backup. |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | development unless `npm run start` | Production enables static serving and security headers. |
| `PORT` | `5173` | Port used by the Node app. |
| `ATLAS_HOST` / `HOST` | production: `127.0.0.1`; development: `0.0.0.0` | Bind host. Use `0.0.0.0` only behind a trusted proxy when exposing production. |
| `ATLAS_ROOT` | current working directory | Application root, set by Electron. |
| `ATLAS_STATIC_DIR` | `<root>/dist` | Production static asset directory. |
| `ATLAS_DATA_DIR` | `<root>/data` | Private data directory for SQLite, backups, and legacy archives. Electron uses app `userData/data`. |
| `ATLAS_DB_PATH` | `<ATLAS_DATA_DIR>/atlas.sqlite` | Optional explicit SQLite database path. Keep it on a local filesystem and back it up consistently. |
| `ATLAS_COOKIE_SECURE` | `false` | Set `true` when serving behind HTTPS. |
| `ATLAS_TRUST_PROXY_HOPS` | `0` | Number of trusted reverse-proxy hops used for client IP/rate-limit identity; set only to the known proxy-chain length. |
| `ATLAS_FORCE_INIT_PRODUCTION` | unset | Explicitly bypass the existing-store guard for a destructive production reset. The reset creates a backup first; prefer restoring or migrating data instead. |
| `ATLAS_ALLOW_DEMO_DATA` | `false` | Allows demo data and demo accounts only when explicitly true. |
| `ATLAS_BACKUP_RETENTION` | `25` | Number of data backups retained. |
| `ATLAS_BACKUP_ON_WRITE` | `false` | Create a backup before each persisted write when true. |

## Production web/local deployment

```bash
npm ci
npm run build
# Fresh/empty data directory only:
npm run init:production
npm run start
```

**Do not run `npm run init:production` as a routine deployment or upgrade command.** It replaces the current workspace with a production first-run store. Existing stores are protected by a guard unless `ATLAS_FORCE_INIT_PRODUCTION=true` is explicitly set; the forced reset creates a backup but still replaces the active store.

For an existing workspace, take/verify a backup, deploy the new build, and restart without initializing or resetting the data directory:

```bash
npm ci
npm run backup:data
npm run build
npm run start
```

Health check:

```bash
curl http://127.0.0.1:5173/api/health
```

Setup status:

```bash
curl http://127.0.0.1:5173/api/setup/status
```

Expected production first-run response:

```json
{ "configured": false, "demoAllowed": false, "demo": null }
```

## One-time legacy JSON import

If a data directory contains `atlas-store.json` but no initialized SQLite workspace, make a separate copy of the entire data directory first, then start the new build normally. Atlas validates/normalizes the document, writes the snapshot to `atlas.sqlite`, and archives the JSON source under `data/legacy/` only after the SQL commit succeeds. Verify `/api/system` integrity and representative records before returning to service. Once SQLite contains a workspace, it takes precedence; changing the archived JSON will not change runtime data. To test an old JSON backup, use a separate empty data directory and name the copied source `atlas-store.json` there.

## Operational boundaries

- Runtime persistence is a local SQLite database at `data/atlas.sqlite` (Electron: `<userData>/data/atlas.sqlite`). Atlas currently loads the whole workspace into each process and writes a snapshot transactionally, so run only one app process per data directory; separate instances could overwrite one another from stale in-memory state despite SQLite transaction locks.
- `data/atlas-store.json` is a one-time legacy import source only when SQLite is uninitialized. It is archived under `data/legacy/` after a successful SQLite commit; JSON exports/settings files are not the runtime source of truth.
- The built-in `node:sqlite` `DatabaseSync` API is synchronous and experimental/RC across the supported Node/Electron lines; large full-snapshot writes can block request handling.
- The service worker caches the static app shell and versioned local assets only after an online visit. API data and writes are not cached or synchronized offline.
- Role permission arrays are enforced by the API. Module/field/action/export/reporting policy maps, workflow transitions/approvals/automation, and integration/webhook registry entries are currently configuration metadata unless a specific setting is described as active in the UI.
- Users with `viewReports` can request all-person activity reports. Confirm that this workspace-wide reporting scope is appropriate for the data before inviting users.
- Authentication uses local email/password accounts and in-memory sessions; MFA/SSO and external identity lifecycle are not included in this build.

## Reverse proxy deployment

If exposing Atlas through a reverse proxy:

1. Keep Atlas bound to `127.0.0.1` when proxy is on the same machine.
2. Terminate HTTPS at the proxy.
3. Set `ATLAS_COOKIE_SECURE=true`.
4. Set `ATLAS_TRUST_PROXY_HOPS` to the exact number of trusted proxy hops (usually `1` for a single local proxy). Never enable trust for arbitrary client-supplied forwarded headers.
5. Forward same-origin requests to Atlas.
6. Preserve cookies.
7. Restrict access at the network layer if Atlas is intended for private use.

Example environment:

```bash
NODE_ENV=production \
ATLAS_COOKIE_SECURE=true \
ATLAS_TRUST_PROXY_HOPS=1 \
ATLAS_HOST=127.0.0.1 \
PORT=5173 \
node dist-desktop/app.mjs
```

## Desktop deployment

### Development desktop launch

```bash
npm run desktop
```

### Unpacked validation build

```bash
npm run desktop:dir
```

### Packaged installers

```bash
npm run desktop:pack
```

Configured Electron Builder targets (the target list is configuration, not proof that installers have been built or signed):

- Windows: NSIS installer and portable build.
- Linux: AppImage and DEB.
- macOS: DMG.

Desktop architecture:

- Electron starts `dist-desktop/app.mjs` in production mode.
- Atlas binds to a private local port.
- BrowserWindow loads `http://127.0.0.1:<port>`.
- Data is stored under Electron `userData/data`.
- Renderer uses context isolation and no Node integration.

Electron 44.5.1 release metadata reports bundled Node 24.21.0, which includes `node:sqlite`; this establishes API availability but is not a packaged-app test. Electron packaging/launch could not be verified in the audit environment because the Electron binary download failed TLS certificate verification. Retry only with a correctly configured CA or cached binary; do not disable TLS verification. Validate launch, SQLite read/write, data storage, legacy import where relevant, installer behavior, and signing on each target OS before distribution.

## Release checklist

Before a release:

- [ ] Use Node `>=22.13.0` (or verify the bundled Electron Node runtime is compatible).
- [ ] `npm ci` completes from the committed lockfile.
- [ ] `npm audit --omit=dev` returns zero vulnerabilities.
- [ ] Full `npm audit` returns zero vulnerabilities.
- [ ] `npm run build` succeeds.
- [ ] `TEST_PORT=5193 node scripts/final-validation.mjs` passes in isolated `.audit-test-data/final-validation-data` and `.audit-test-data/legacy-json-import-data` directories; the script validates those paths before cleaning them and writes its result record under the primary validation directory.
- [ ] On a fresh isolated data directory only, `npm run init:production` leaves a first-run production store; do not run it against an existing workspace.
- [ ] `/api/setup/status` returns no demo credentials.
- [ ] First-run setup creates an administrator.
- [ ] Login succeeds with that administrator.
- [ ] Create team, person, project, task.
- [ ] Drag/drop or patch a task status to `Done`.
- [ ] Daily, weekly, monthly all-person activity reports return task/project evidence; confirm all-person visibility matches workspace privacy policy.
- [ ] General daily, weekly, monthly, quarterly, yearly reports load.
- [ ] CSV, Excel, JSON, PDF, and print workflows are checked.
- [ ] `npm run desktop:dir` succeeds.
- [ ] Packaged app opens setup/login and uses Electron userData for data.
- [ ] Documentation reflects current commands and schema.

## Signing and distribution notes

Electron Builder configuration prepares artifacts, but production distribution normally also requires platform signing:

- Windows: code-signing certificate for NSIS/portable trust.
- macOS: Apple Developer ID signing and notarization.
- Linux: repository/package signing if distributing through managed repositories.

Signing credentials are intentionally not stored in the repository or workspace.

## CI recommendation

A minimal CI pipeline should run:

```bash
npm ci
npm audit --omit=dev
npm audit
npm run build
node scripts/final-validation.mjs
ATLAS_DATA_DIR="$(mktemp -d)" npm run init:production
npm run desktop:dir
```

The `mktemp` data directory ensures CI initialization is isolated. Never point that command at a persistent production store.

Use a Node 22.13+ CI image.

