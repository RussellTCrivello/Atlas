# Atlas Workspace

Atlas is a local-first engineering operations workspace: projects, tasks on a board, people and teams, daily updates, alerts,
reports and exports, in one Node.js application with a React interface and an optional Electron desktop shell.

It is built for **one workspace on one machine or one small server** (a team, not a company). Data lives in a single JSON
file; there is no external database, cloud service or CDN. See [Scope and limits](#scope-and-limits) before choosing it for
anything larger.

## Quick start (development)

```bash
nvm use            # Node 22 (see .nvmrc); engine-strict is on
npm ci             # installs exactly what package-lock.json pins
npm run app        # http://127.0.0.1:5173, loopback only
```

The first run prints a **one-time setup token** in the terminal. Open the URL, walk through the setup wizard and paste the
token on the last step. The token proves that whoever completes setup controls the server; once a workspace exists the setup
endpoint refuses further calls.

Development demo data (public passwords, development only; refused under `NODE_ENV=production`):

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data   # then sign in as maya@atlas.local / atlas-demo
```

## Run in production

```bash
npm ci
npm run build      # web app -> dist/, self-contained server bundle -> dist-desktop/app.mjs
npm start          # NODE_ENV=production, listens on 127.0.0.1:5173
```

`dist-desktop/app.mjs` has its dependencies bundled in, so a deployment is just that file plus `dist/`. Put it behind a
TLS-terminating reverse proxy if anyone but the local user will connect. **Read [`PRODUCTION.md`](PRODUCTION.md)** for the
environment variables, reverse-proxy example, backups and upgrade procedure.

Desktop app: `npm run desktop` (development shell) or `npm run desktop:pack` (installers). Packaging has not been verified
end to end in the environment used for this release; see [`PRODUCTION.md`](PRODUCTION.md#desktop-app).

## Commands

| Command                                          | What it does                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `npm run app` / `dev` / `web`                    | Development server (tsx + Vite), loopback only                              |
| `npm run build`                                  | Production build of the web app and the server bundle                       |
| `npm start`                                      | Run the production build (`npm run preview` builds first)                   |
| `npm test`                                       | Server, API and UI regression tests (`node:test`, jsdom, no browser needed) |
| `npm run test:acceptance`                        | Acceptance tests against the **built** bundle (run `npm run build` first)   |
| `npm run typecheck`                              | TypeScript: server (strict), client, tests                                  |
| `npm run format` / `format:check`                | Prettier                                                                    |
| `npm run check`                                  | typecheck + format check + tests                                            |
| `npm run backup:data`                            | Verified copy of the store into `backups/` (safe while the server runs)     |
| `npm run list:backups`, `npm run restore:data`   | List backups / restore one (`-- latest` or a file name; server must be off) |
| `npm run check:data`                             | Validate the store without starting the server                              |
| `npm run admin:reset-password`                   | `-- --email you@example.com [--activate] [--role Administrator]`            |
| `npm run init:production`                        | **Destructive**: empty workspace (needs `-- --yes`; backs up first)         |
| `npm run reset:data`                             | Development demo data (needs `ATLAS_ALLOW_DEMO_DATA=true`)                  |
| `npm run desktop`, `desktop:dir`, `desktop:pack` | Electron development shell / unpacked package / installers                  |

## What is in the box

- **Work management**: projects with milestones, a task board and list (drag and drop _and_ keyboard/touch-friendly "Move to"),
  people and teams, daily updates with blockers, alerts, an advanced filter builder (AND binds tighter than OR, ISO-date
  comparisons), exports to PDF, Excel, CSV and JSON.
- **Reports** built from an append-only **work ledger** (what was created, moved, completed, by whom and when) plus current due
  dates. History does not change when a task is later edited, re-opened or deleted. Atlas records what happened, **not how
  long it took**: it produces no time-spent figures.
- **Roles and permissions** (Administrator, Manager, Developer, Viewer, plus custom roles) enforced on the server. Developers
  can move any task through the workflow but only re-plan tasks assigned to or created by them.
- **Languages**: English, Arabic, Persian and Hebrew with right-to-left layout. User-entered data is never translated.
  Non-English strings were written without native-speaker review; see the open questions.
- **Settings console** for workspace, interface, localisation, workflow, roles, reports and system. Settings that are stored
  but not yet applied by Atlas are labelled **Not applied yet** and disabled.
- **Local assets only**: fonts, icons and scripts are bundled. No remote requests.

## Security in one paragraph

Loopback-only by default; strict security headers and CSP; Host and Origin checks; one-time setup token; scrypt password
hashes (async, bounded concurrency); login throttling and lockout; 256-bit server-side sessions that survive restarts and
expire; forced password change for admin-set passwords; role-scoped API responses; every write validated; tamper-evident
audit trail. Details, residual risks and what is _not_ protected: [`docs/SECURITY.md`](docs/SECURITY.md).

## Scope and limits

- One process owns the data directory (a lock file enforces it). There is no clustering or high availability.
- The JSON store is rewritten as a whole on every change. Measured on a 2-core sandbox: ~80 ms per write at 10,000 tasks, ~400 ms
  at 50,000; the browser receives all tasks at load, so beyond roughly **10,000 tasks** server-side pagination or a database
  becomes necessary. See [`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md).
- Notifications, integrations, webhooks, approval steps, working-hours calendars and field-level permissions are **not
  implemented**; their settings are stored only.
- It is not an offline application: all data lives on the server. The service worker only caches static assets and shows an
  explanatory page when the server is unreachable.

Open product and governance decisions are listed in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md).

## Project layout

```text
app.tsx            thin entry point (keeps `tsx app.tsx` and the build target stable)
server/            Express app: config, store, auth, validation, routes, reports, CLI
shared/            code used by both sides: settings model, password policy, translation catalog
src/               React client (main.tsx = screens, lib/ = tested helpers, styles.css)
electron/          desktop shell (main, preload, navigation rules)
public/            static assets (fonts, icons, manifest, service worker, offline page)
tests/             server/, ui/ (jsdom against a real server), acceptance/ (built bundle)
docs/              reference documentation; docs/history/ holds superseded point-in-time reports
```

## Documentation

[`docs/README.md`](docs/README.md) is the index. Start with [`PRODUCTION.md`](PRODUCTION.md) (operators),
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (contributors) and [`docs/SECURITY.md`](docs/SECURITY.md).
Third-party licences: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Changes: [`CHANGELOG.md`](CHANGELOG.md).
