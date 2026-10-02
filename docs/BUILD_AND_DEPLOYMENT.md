# Atlas Workspace Build and Deployment Guide

## Required runtime

Use Node.js `>=22.12.0` for production build and packaging.

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
| `npm run init:production` | Reset data to production first-run setup. |
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
| `ATLAS_DATA_DIR` | `<root>/data` | Data-store directory. Electron uses app `userData/data`. |
| `ATLAS_COOKIE_SECURE` | `false` | Set `true` when serving behind HTTPS. |
| `ATLAS_ALLOW_DEMO_DATA` | `false` | Allows demo data and demo accounts only when explicitly true. |
| `ATLAS_BACKUP_RETENTION` | `25` | Number of data backups retained. |
| `ATLAS_BACKUP_ON_WRITE` | `false` | Create a backup before each persisted write when true. |

## Production web/local deployment

```bash
npm install
npm run init:production
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

## Reverse proxy deployment

If exposing Atlas through a reverse proxy:

1. Keep Atlas bound to `127.0.0.1` when proxy is on the same machine.
2. Terminate HTTPS at the proxy.
3. Set `ATLAS_COOKIE_SECURE=true`.
4. Forward same-origin requests to Atlas.
5. Preserve cookies.
6. Restrict access at the network layer if Atlas is intended for private use.

Example environment:

```bash
NODE_ENV=production \
ATLAS_COOKIE_SECURE=true \
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

Configured Electron Builder targets:

- Windows: NSIS installer and portable build.
- Linux: AppImage and DEB.
- macOS: DMG.

Desktop architecture:

- Electron starts `dist-desktop/app.mjs` in production mode.
- Atlas binds to a private local port.
- BrowserWindow loads `http://127.0.0.1:<port>`.
- Data is stored under Electron `userData/data`.
- Renderer uses context isolation and no Node integration.

## Release checklist

Before a release:

- [ ] Use Node `>=22.12.0`.
- [ ] `npm install` completes.
- [ ] `npm audit --omit=dev` returns zero vulnerabilities.
- [ ] Full `npm audit` returns zero vulnerabilities.
- [ ] `npm run build` succeeds.
- [ ] `npm run init:production` leaves a first-run production data store.
- [ ] `/api/setup/status` returns no demo credentials.
- [ ] First-run setup creates an administrator.
- [ ] Login succeeds with that administrator.
- [ ] Create team, person, project, task.
- [ ] Drag/drop or patch a task status to `Done`.
- [ ] Daily, weekly, monthly user activity reports return task/project evidence.
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
npm run init:production
npm run desktop:dir
```

Use a Node 22.12+ CI image.

