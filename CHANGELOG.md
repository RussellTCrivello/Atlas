# Changelog

## Unreleased: remediation of the 2026-10-02 audit

Addresses the findings in [`docs/AUDIT_REPORT_2026-10-02.md`](docs/AUDIT_REPORT_2026-10-02.md) (IDs such as SEC-01 below refer to it).
Decisions that the repository cannot answer are in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md).

### Behaviour changes to know about before upgrading

- **First-run setup needs a one-time token** (printed in the server console, or `ATLAS_SETUP_TOKEN`; the desktop app supplies
  it itself) and `POST /api/setup` answers `409` once a workspace exists. It used to wipe and replace a configured workspace
  for anyone who could reach the port (SEC-01).
- **The development server binds to `127.0.0.1`** (was `0.0.0.0`) and serves only `src`, `shared`, `public`, `node_modules` and
  `index.html` (SEC-02). Set `ATLAS_HOST` to expose it deliberately.
- **Data migrates automatically to store schema `3.1.0`**, after a `pre-migration` backup. It removes ledger rows and "minutes"
  that earlier versions invented, freezes task keys, resets role ranks and drops frozen copies of the built-in translations.
  Downgrading is not supported; restore the pre-migration backup instead (DATA-04).
- **Reports changed meaning where the old numbers were wrong** (REP-01/02/03): `planned` is now "tasks that came due in the
  period", `created`/`delivered` were added, `rate` is delivered ÷ planned (0-100, `null` when nothing was due), counts are
  distinct tasks, history comes from the ledger. **There are no effort/minutes figures anywhere.**
- **Per-person activity is limited to managers/administrators** unless an administrator sets Settings → Reports → "Everyone"
  (GOV-02). Everyone always sees their own.
- Accounts whose password an administrator set (create or reset) **must change it at first sign-in** (SEC-06).
- `PUT /api/settings` is an RFC 7386 **merge patch**; send only what changes (VAL-03).
- Developers can still move any task, but can re-plan (title, project, assignee, priority, type, due date) only tasks assigned to
  or created by them (SEC-07).
- The top-bar theme toggle is **personal**; so are language and density (Settings → My account). Settings for people without
  `manageSettings` is now "My account" (UX-07).
- "New task" shortcut is `Ctrl/⌘ + Shift + N` (plain `Ctrl+N` collides with the browser's new window).
- `ATLAS_ALLOW_DEMO_DATA` is ignored under `NODE_ENV=production`; `reset:data` refuses without it; `init:production` needs
  `--yes`; removing demo data also removes the demo accounts (SEC-09).
- `npm start` runs `scripts/start.mjs`; `dist-desktop/app.mjs` is built (no longer committed) and **self-contained**.
- The default time zone for new workspaces is the host's (was hard-coded `America/Los_Angeles`).
- Password hashes use scrypt N=2^17 with parameters stored per hash; older hashes keep working and are upgraded on sign-in.

### Security

- Setup takeover closed; fail-closed start-up for unreadable/newer stores; dev-server exposure fixed (SEC-01, SEC-02, DATA-01).
- Unauthenticated `POST /api/i18n/missing` now needs a session and is memory-only and bounded (SEC-03).
- Async, bounded password hashing; sign-in throttling and lockout; no user enumeration by timing (SEC-04).
- Server-side sessions: 256-bit tokens (hashed at rest), persisted, expiring (`sessionDays`), revocable, new token per sign-in;
  password change, reset, disable and delete end sessions (SEC-05).
- Password policy (length, deny-list), change-password endpoint and screen, sign-out everywhere, CLI reset for locked-out
  administrators (SEC-06, SEC-08, SEC-09).
- Role-scoped `/api/bootstrap`, ownership rules for task edits, activity attribution, rank checks and a last-administrator guard,
  unique emails and person links, own-property role lookups (SEC-07, SEC-08, SEC-09, MIN-05).
- Security headers, strict CSP, Host and Origin checks, JSON errors and 404s, compression, `Cache-Control` (SEC-10, MIN-02).
- CSV formula injection neutralised; export permission enforced and audited server-side (SEC-12).
- Hash-chained audit trail with actor/IP/user agent, failed sign-ins and denials recorded, viewer in Settings (SEC-13).

### Data integrity

- Atomic fsynced writes, rollback on failure, `503` + health when the disk fails, single-writer lock, daily and pre-risk
  backups with per-kind retention, `restore`/`check`/`list` commands (DATA-01, DATA-02, DATA-03, DATA-06, DATA-07).
- Referential integrity, unique project codes, frozen task keys, delete protection and cascade confirmation, workflow renames
  carry tasks along (DATA-05).
- The ledger records facts and the actor only; the back-filled rows and fixed "minutes" are gone (DATA-04).
- Every request body validated; stored settings sanitised so a bad value cannot break every route (VAL-01..05).

### Product behaviour

- "My work" defaults to my tasks with counts; windows with "Show more"; exports use the full filtered set; explicit advance and
  "Move to" controls instead of click-to-advance; keyboard-reachable cards (UX-01, UX-02, UX-06).
- The localiser no longer rewrites user data, works from per-node sources and only visits changed nodes (UX-03).
- Failure handling: central API wrapper, session-expiry routing, error boundary, load-failure screen, offline notice, dirty-form
  guard, descriptive delete confirmations (UX-04, UX-06).
- Accessibility: visible focus, 4.9:1 secondary text, dialog semantics, labelled icon buttons, live regions, reduced-motion and
  contrast preferences (UX-05). Not audited with real assistive technology.
- Pages have URLs; screens refresh when someone else changes data; query builder precedence and date comparison (UX-08, UX-09).
- Settings console labels what is not applied and saves only changes (UX-07).

### Desktop and PWA

- One instance, sandboxed and navigation-confined window, minimal preload, real menu roles, graceful shutdown, recovery dialog
  for an unreadable store, random remembered port (DESK-01..03).
- Service worker rebuilt (versioned cache, offline page), PNG and maskable icons, desktop icons generated (DESK-04, DESK-05).

### Build, quality, documentation

- Dependencies pinned, `.nvmrc`, `engine-strict`; server split into modules (strict TypeScript, 0 errors; client 0 errors, was 432);
  Prettier; CI workflow and Dependabot (BUILD-01, BUILD-02, ARCH-03, QA-01).
- Test suites: server/API/store/CLI, UI in jsdom, acceptance against the built bundle; the old `final-validation` script and
  its tracked results file were removed (QA-01, QA-02).
- Documentation rewritten to match the code (`README`, `PRODUCTION`, `SECURITY`, data, API, operations, development, build);
  point-in-time reports moved to `docs/history/`; third-party notices and font licence (DOC-01, DOC-02, BUILD-03).

### Not done (see the open questions)

SQLite or server-side pagination (scale beyond ~10,000 tasks), notifications/integrations/approval workflows, SSO/MFA,
offline mode, installers verified on real machines, code signing, native-speaker translation review, screen-reader testing,
licence choice.
