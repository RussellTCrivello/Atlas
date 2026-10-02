# Atlas Workspace Developer Guide

## Requirements

Production toolchain target:

- Node.js `>=22.12.0`
- npm compatible with Node 22+

The current sandbox can run the web/server build on Node 20, but Electron 44 and related production packaging packages declare Node `>=22.12.0`. Use Node 22.12+ for real development, CI, and packaging.

## Install

```bash
npm install
```

## Run locally

```bash
npm run app
```

Aliases:

```bash
npm run web
npm run dev
```

All aliases run the same single Node.js TSX application entrypoint, `app.tsx`.

## Production first-run data

```bash
npm run init:production
```

This resets `data/atlas-store.json` to first-run production mode:

- no users
- no sample teams/people/projects/tasks
- no demo credentials
- schema metadata initialized

## Development sample data

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data
```

Demo credentials are development-only and appear only when demo data is explicitly allowed.

## Build

```bash
npm run build
```

This runs:

1. `npm run build:web` — Vite production build into `dist/`.
2. `npm run build:server` — esbuild bundle of `app.tsx` into `dist-desktop/app.mjs`.

## Project structure

```txt
app.tsx                    Single Node.js app: Express, data store, RBAC, API, reports, static serving.
src/main.tsx               React/TSX interface.
src/styles.css             Local design system, tokens, layout, responsive styles, print/export UI styles.
src/desktop.js             Browser/Electron display-mode helper.
index.html                 Vite HTML entry.
public/fonts/              Local bundled fonts.
public/atlas-icon.svg      Local app icon source.
public/manifest.webmanifest PWA manifest.
public/sw.js               Service worker for local shell assets.
electron/main.cjs          Electron main process; starts the bundled Atlas server.
electron/preload.cjs       Safe desktop metadata bridge.
build/icon.png             Desktop/PWA icon.
build/icon.ico             Windows icon.
data/atlas-store.json      Local embedded database file.
docs/                      Complete project documentation.
```

## Runtime architecture

Atlas deliberately remains one application:

- Express API and React app are served from `app.tsx`.
- Development uses Vite middleware inside the same Node process.
- Production serves static `dist/` assets from the same Node process.
- Electron starts the same bundled Node application and loads it from `127.0.0.1`.

Do not split Atlas into separate client and server applications unless the product direction changes.

## Coding standards

### General

- Keep application behavior inside the single Node/TSX project.
- Do not add external UI/CDN dependencies for core rendering.
- Keep all fonts and visual assets local.
- Keep public API responses free of password hashes and sensitive session data.
- Keep production defaults free of demo/test records unless explicitly enabled.

### Server/API

- Add routes in `app.tsx`.
- Always use `requireUser` for authenticated routes.
- Always use `requirePermission()` or `requireAdmin` for mutating or sensitive routes.
- Use `sendError(res, status, message)` for consistent errors.
- Call `persist()` after changing the store.
- Update work logs when actions should appear in activity reports.
- Update `validateStoreState()` when introducing new relationships.

### Data/schema

When adding a field or entity:

1. Add defaults to `productionStore()` or `defaultSettings()`.
2. Add migration/normalization in `normalizeStore()`.
3. Add integrity validation in `validateStoreState()`.
4. Update public mappers if the UI needs the field.
5. Update API docs and functionality docs.
6. Add smoke-test coverage.

### UI

- Use the existing component patterns in `src/main.tsx`.
- Use design tokens and existing classes in `src/styles.css` before creating new one-off styles.
- Add role-aware controls and read-only states.
- Keep report/export controls near the data they export.
- Preserve keyboard focus states.

### CSS

- Use CSS custom properties from `:root`.
- Do not import external stylesheets.
- Do not reference external fonts or images for product UI.
- Responsive additions should fit the existing sidebar/topbar/content shell.

## Adding a new feature

1. Define the user problem and role permissions.
2. Define data shape and relationships.
3. Update data normalization and integrity validation.
4. Add API routes with permission enforcement.
5. Add UI using design-system classes.
6. Add export/report behavior when the data is operationally relevant.
7. Update docs.
8. Run validation commands.

## Validation workflow

Recommended before every handoff:

```bash
npm run build
npm audit --omit=dev
npm audit
npm run init:production
```

Then run a production smoke test in a temporary data directory:

```bash
PORT=5185 NODE_ENV=production ATLAS_DATA_DIR=/tmp/atlas-prod-smoke node dist-desktop/app.mjs
```

Validate:

```bash
curl http://127.0.0.1:5185/api/health
curl http://127.0.0.1:5185/api/setup/status
```

Then create an admin through `/api/setup`, create representative records, complete a task, and verify `/api/reports/activity/daily?userId=<personId>`.

## Desktop development

```bash
npm run desktop
```

This builds the web and server bundle, then launches Electron.

Electron behavior:

- Sets `NODE_ENV=production`.
- Selects an available local port.
- Sets `ATLAS_ROOT`, `ATLAS_STATIC_DIR`, and `ATLAS_DATA_DIR`.
- Imports `dist-desktop/app.mjs`.
- Loads `http://127.0.0.1:<port>` in a BrowserWindow.

## Common issues

### `vite: not found`

Run:

```bash
npm install
```

### Node engine warnings

Use Node `>=22.12.0`. The Electron production toolchain expects it.

### Cannot sign in

- Confirm the workspace has been configured.
- Visit `/api/setup/status`.
- If `configured` is false, complete first-run setup.
- If configured, ask an administrator to create or activate your account.

### Reports are empty

Activity reports depend on work-log evidence. Create/update/complete tasks or log activity to generate rows.

