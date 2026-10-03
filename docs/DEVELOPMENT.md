# Developer guide

## Requirements and setup

- Node.js **22.12 or newer** (`.nvmrc` says 22; `.npmrc` sets `engine-strict`). npm 10+.
- `npm ci` (not `npm install`) installs exactly what `package-lock.json` pins. The Electron binary is only needed for the
  desktop shell; skip it with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` when you only work on the web app, server or tests.

```bash
npm run app          # tsx + Vite on http://127.0.0.1:5173 (loopback; HMR shares the HTTP port)
npm run check        # typecheck + format check + tests: run before every pull request
```

The first run prints a one-time setup token; paste it on the last step of the setup wizard. For development data with public
demo accounts: `ATLAS_ALLOW_DEMO_DATA=true npm run reset:data` (refused under `NODE_ENV=production`). Development data lives in
`./data` (git-ignored); use `ATLAS_DATA_DIR=/tmp/atlas-dev npm run app` for a throw-away workspace.

## Layout

| Path                                             | Responsibility                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.tsx`                                        | Thin entry point. Kept at the root because the build, Electron and docs refer to it.                                                                |
| `server/index.ts`                                | `createApp`, `startServer` (Vite in development, static files in production), lifecycle, and the CLI (`--backup-data`, `--restore`, …).             |
| `server/config.ts`                               | All environment parsing and validation.                                                                                                             |
| `server/store.ts`                                | `DocumentStore`: lock file, atomic fsynced writes, `commit()` with rollback, backups, restore.                                                      |
| `server/migrations.ts`                           | Store creation, versioned migrations, normalisation, integrity validation.                                                                          |
| `server/auth.ts`                                 | scrypt hashing, sessions (hashed tokens, persisted), login throttling.                                                                              |
| `server/schemas.ts`                              | zod schemas for every request body and the semantic checks for settings.                                                                            |
| `server/domain.ts`                               | Permissions, workflow helpers, workspace-time-zone dates, per-request indexes.                                                                      |
| `server/ledger.ts`, `audit.ts`                   | The work ledger (facts only) and the hash-chained audit trail.                                                                                      |
| `server/presenters.ts`, `reports.ts`, `views.ts` | Response shapes, report maths, role-scoped bootstrap.                                                                                               |
| `server/http.ts`                                 | Security headers, Host/Origin guards, JSON error handling.                                                                                          |
| `server/api/*.ts`                                | Routes: `auth.ts` (setup, sign-in, account), `data.ts` (tasks, projects, people, …), `admin.ts` (users, settings, i18n, system, reports).           |
| `shared/`                                        | Code both sides import: `settings.ts` (defaults, merge-patch, normalisation), `password.ts`, `i18n/` (built-in catalog and phrase tables).          |
| `src/main.tsx`                                   | The screens. `src/lib/`: `api` (the only place that calls `fetch`), `i18n` (localiser), `filters`, `csv`, `export`, `format`, `labels`, `settings`. |
| `electron/`                                      | `main.cjs` (shell), `preload.cjs` (minimal bridge), `security.cjs` (navigation rules, unit-tested).                                                 |
| `tests/`                                         | `server/` (in-process API and store tests), `ui/` (the real client bundle in jsdom against a real server), `acceptance/` (the built bundle).        |
| `scripts/`                                       | `start.mjs` (`npm start`), `ops.mjs` (operations commands), `make-icons.mjs`, `i18n-coverage.mjs`.                                                  |

## Rules that keep the data safe (server)

1. **Validate first.** Every body goes through a zod schema in `server/schemas.ts` (unknown keys are stripped). Never persist
   unvalidated input; check references (`requireProject`, `requirePerson`, …).
2. **Checks before mutation, one `commit`.** `db.commit(state => …)` rolls back on any non-`HttpError` exception and on a failed
   write, but assumes an `HttpError` left the state untouched. Mutate, write the ledger row and the audit row inside the same
   `commit`. There must be no `await` between reading state and committing; do async work (hashing) before.
3. **Ledger = facts.** Record what happened and who did it (`recordEvent`); never store estimates or invented numbers as if they
   were measurements.
4. **Permissions on the server.** Use `requirePermission(deps, 'x')` and, for ownership rules, check inside the handler.
   Never trust the role or permissions a client sends; never add an "Administrator can do everything" shortcut.
5. **Presenters must not throw** on odd stored data (use the helpers in `server/util.ts`/`domain.ts`).
6. **Errors**: throw `HttpError` (or the helpers `badRequest`, `conflict`, `forbidden`, `notFound`) with a message a person can read.
7. **Migrations** are idempotent, preceded by a backup (automatic), and need a fixture-based test. Bump `STORE_SCHEMA_VERSION`
   in `shared/settings.ts` together with the new entry in `MIGRATIONS`.

## Rules for the client

- Talk to the server only through `src/lib/api.ts`. Show failures: a toast (`notify`) for actions, an inline message in forms,
  a retry screen for failed loads. Never leave an unhandled rejection.
- **Text**: write UI text in English in JSX. Text with parameters must be one whole sentence through `tr(settings, 'Showing
{shown} of {total}', {…})` (word order differs between languages); add the phrase to `shared/i18n/ui-phrases.json` for
  **all four** languages with the same `{placeholders}` (`npm run i18n:coverage` lists strings that have no entry). The DOM
  localiser never rewrites values that appear in the loaded workspace data; mark static data-only blocks with `translate="no"`.
  All non-English text needs native-speaker review.
- Icon-only buttons need `aria-label`; dialogs need `role="dialog"`, a label, Escape handling and focus return; clickable things
  must be buttons or have `role="button"`, `tabIndex` and key handling. Do not remove focus outlines.
- Destructive actions say what will be lost and how many things go with it.
- A new setting needs (a) a default in `shared/settings.ts`, (b) validation in `settingsProblems`, (c) code that **reads** it,
  or an entry in `src/lib/settings-status.ts` so the console labels it "Not applied yet". No silent no-ops.
- Anything that pages through lists must show "Showing X of N" and let the user see all of them; exports use the full
  filtered set, never the visible window.

## Tests

```bash
npm test                                                          # server + UI suites (about 80 s)
node --import tsx --test --test-reporter=spec tests/server/data.test.ts        # one file
node --import tsx --test --test-name-pattern="lockout" tests/server/*.test.ts  # by name
npm run build && npm run test:acceptance                          # the built bundle in its own process
```

- `tests/server/*`: start a real server in-process on a temp directory and a random port (`launch()`, `setupAdmin()`,
  `makeUser()` and `Api` in `tests/helpers/server.ts`). Prefer asserting on HTTP behaviour; reach into `server.db` only to prove
  persistence or to damage data on purpose.
- `tests/ui/*`: bundle `src/main.tsx` with esbuild and run it in jsdom against a real server (`bootUI()`); you click, type and
  read the DOM. `a11y.test.ts` runs axe-core (WCAG 2.x A/AA) over every screen, the sign-in page, the Arabic/RTL interface and the
  dialogs, panels and command palette. **jsdom is not a browser**: layout, CSS (so colour contrast), focus rings and real input
  devices are not covered. A real-browser
  suite (Playwright) is not set up because browsers could not be installed where this was developed; adding one is a good next
  step.
- `tests/acceptance/*`: spawn `dist-desktop/app.mjs` and check start-up, failure modes (corrupt store, second process, crash),
  restore, a standalone copy with no `node_modules`, and a 1,000-task load check. `audit-replay.test.ts` replays the audit's
  reproductions (setup takeover, brute force, forged activity, poison values, backup retention, launchers) against the bundle;
  it fails against the original 1.0.0 bundle.
- Every fixed audit finding has a regression test named after the behaviour; keep it that way.
- Never point a test at the real `./data`. Use `launch()` (temp directory) or set `ATLAS_DATA_DIR`.

`npm run typecheck` runs `tsc` three times: `tsconfig.server.json` (**strict**, server + shared), `tsconfig.json` (client),
`tsconfig.tests.json`.

## Adding a feature (checklist)

1. Shared shape or setting? `shared/settings.ts` and `server/types.ts`.
2. Schema in `server/schemas.ts`; route in `server/api/*.ts` with permission, validation, `commit`, ledger/audit.
3. Presenter/report/view changes (`server/presenters.ts`, `reports.ts`, `views.ts`) and the role-scoping in `views.ts`.
4. UI in `src/main.tsx` (keep helpers that can be unit-tested in `src/lib/`), text through `tr()`, a11y per the rules above.
5. Tests at the right level, including the permission-denied and bad-input paths.
6. Docs: `docs/API_REFERENCE.md`, `CHANGELOG.md`, and `docs/DECISIONS_AND_OPEN_QUESTIONS.md` if you made a product choice.

## Gotchas

- Vite serves only `src`, `shared`, `public`, `node_modules` and `index.html` in development (`server/index.ts`). If client code
  must import from a new top-level folder, add it to `fs.allow` there.
- Directory names such as `build`, `dist`, `node_modules` and `tmp` are git-ignored or generated; icons in `build/` are
  committed (regenerate with `scripts/make-icons.mjs`).
- `npm run build` bundles **all** server dependencies into `dist-desktop/app.mjs` (only `vite` is external and is never loaded
  in production). Adding a native module would break that; talk first.
- Sign-in costs ~300 ms of scrypt by design. Tests create users through the API, so a file with many users is slow; reuse
  users across tests.
- Dates are workspace-time-zone strings (`YYYY-MM-DD`). Never build "today" with `new Date().toISOString().slice(0, 10)`;
  use `todayIn(settings)`.
