# Atlas Architecture and Acceptance Report

**Audit date:** 2026-10-02

**Scope:** Runtime persistence, server/client modularization, API/data behavior, migration, security wiring, build, validation, and deployment documentation.

## Executive conclusion

Atlas now uses SQLite as the only runtime persistence source. The former `atlas-store.json` is accepted only as a one-time import source when SQLite has no workspace snapshot, and is archived after a successful SQL commit. Server responsibilities are split into database, domain, HTTP middleware, route groups, and shared-helper modules under `src/server/`; `app.tsx` is the server composition root. The browser API client, common UI, saved-filter context/repository, filtering and migration helpers, localization runtime, workspace defaults, forms, navigation, and feature pages are organized into role-specific modules under `src/`. `src/main.tsx` is now a compact client composition/state root rather than the home of feature implementations.

The production web/server build succeeded, and the latest isolated production workflow passed **33/33 checks**, including per-user SQL filter storage, v1-to-v2 migration, failed-write rollback, CRUD, roles, backup/restore, restart persistence, one-time JSON import/archive, SQL integrity/foreign keys, and preservation of imported data. This supports **local/internal evaluation**, not an internet-facing security certification, multi-process deployment, browser accessibility certification, or a completed packaged Electron release.

## Implemented changes and resolved findings

| Finding | Correction |
| --- | --- |
| The prior runtime persisted one whole workspace document as JSON, making SQL constraints, transactions, backups, and queryable relationships unavailable. | Added SQLite schema/migrations, typed relational tables, indexes, case-insensitive uniqueness, foreign keys, a transactional snapshot repository, integrity checks, and `VACUUM INTO` backups. Runtime state is read/written through SQLite; JSON exports/configuration and the one-time legacy source are not runtime persistence. |
| Server routes/domain/security/time/store rules were concentrated in the app entry point. | Extracted `src/server/database/`, `domain/`, `http/`, `routes/`, and `shared/` modules with explicit dependency injection. Route files are grouped by responsibility and registered centrally. |
| A successful legacy import could be followed by first-run setup replacing imported, unconfigured records. | Setup now clones/preserves the existing workspace, adds or links the administrator profile, reuses an existing team with the selected name, and refuses demo seeding into a non-empty workspace. The acceptance fixture verifies records, relationships, custom fields, explicit work-log values, source archive, and restart behavior. |
| Date helpers assumed all stored values were date-only strings; valid ISO timestamps could fail bootstrap/report generation. | Date formatting and report bucket normalization handle both calendar dates and timestamp values, safely ignoring invalid dates. The imported fixture includes timestamp-valued alert/task fields. |
| Earlier normalization discarded deterministic generated work-log rows but also zeroed every remaining legacy row's minutes. | Migration now removes only identifiable generated `wl_seed_*`/`wl_activity_*` rows and preserves explicit imported history/minutes. New application events continue to record zero minutes unless a real time-entry feature is implemented. |
| SQL schema changes and legacy record fidelity needed verification. | Repository round-trips typed fields, custom JSON values, identifier types, ordering, and empty/null/missing states; transactions run FK checks before commit. Validation covers backup restore, schema version normalization, explicit minutes, integrity, and FK constraints. |
| Initial setup could duplicate a team/person where imported content already had the same team name or administrator email. | Setup reuses a matching existing team and links to a matching person instead of inserting conflicting duplicates. The import acceptance fixture checks this behavior. |
| Package engine range allowed a Node 22 version where built-in `node:sqlite` still required an extra flag. | Minimum Node engine is now `>=22.13.0`; package manifest and lockfile agree. |
| Advanced-filter conditions were the remaining application data stored in browser `localStorage`, and clearing a filter chip did not clear the builder's draft. | Added schema v2 `user_preferences` SQL storage per account, authenticated/validated preference endpoints, serialized browser saves, and a one-time guarded import of legacy `atlas-filter-*` values. SQL settings win during import; legacy browser keys are cleared only after the server confirms the SQL state. Chip clear/remove now persists and synchronizes with the builder. |
| A failed SQLite snapshot write rolled back SQL but could leave the failed mutation in the process's in-memory workspace. | `persist()` now reloads the last committed SQL snapshot after any write failure. An injected SQLite trigger verifies failed CRUD is absent from SQL and memory and does not reappear after a later write. |
| Production initialization could overwrite existing data without an explicit override. | Existing-store protection remains in place. Fresh isolated init succeeded; a second init was refused and the database SHA-256 remained unchanged. |
| The frontend entry file mixed localization catalogs, defaults, navigation, forms, administration, and operational pages, making feature ownership difficult to maintain. | Split client concerns into `src/components/`, `src/pages/`, `src/config/`, `src/i18n/`, `src/context/`, `src/api/`, and `src/lib/`. `src/main.tsx` now composes the app and owns cross-page runtime state; page and shared component implementations live in responsibility-specific modules. |
| Other previously audited UI/API defects: inconsistent action/role affordances, unredacted integration secrets, hidden-module navigation, blocker alert deduplication, weak custom-field enforcement, settings error visibility, non-JSON API failures, reverse-proxy IP handling, and offline-shell behavior. | Prior corrections remain in place. Role capabilities are still enforced at API boundaries; the outstanding policy limitations below are not presented as security controls. |

## Data and schema model

- Runtime database: `<ATLAS_DATA_DIR>/atlas.sqlite`; default `data/atlas.sqlite`.
- Electron database: `<userData>/data/atlas.sqlite`.
- Physical schema version: SQLite `PRAGMA user_version = 2`.
- Domain data schema: `4.0.0`.
- Tables include teams, people, projects, tasks, milestones, activities, alerts, users, per-user `user_preferences`, work logs, audit logs, settings, metadata, counters, and migration history.
- Writes use SQLite transactions, foreign-key checks, WAL journaling, and `synchronous=FULL`.
- Backups are standalone `.sqlite` files created with `VACUUM INTO`; restore only with Atlas stopped and stale WAL/SHM files handled as documented.
- Legacy JSON imports are archived under `<ATLAS_DATA_DIR>/legacy/` after commit. Corrupt JSON is moved aside rather than silently parsed as valid data.

## Fresh verification

- `npm run build` — passed after the client split; Vite transformed 240 modules and esbuild produced `dist-desktop/app.mjs` (197.5 kB).
- `npm run test:unit` — passed advanced-filter/sort utilities, legacy browser-filter import/merge/cleanup checks, and localization-catalog/translation behavior.
- `TEST_PORT=5193 node scripts/final-validation.mjs` — **33/33 checks passed**. The latest raw record is [`audit-validation-results-2026-10-02.json`](audit-validation-results-2026-10-02.json). It includes schema v1-to-v2 migration, per-user preference isolation and restart/backup persistence, invalid-preference rejection, injected failed-write rollback, production API setup/auth, role-based CRUD, settings import/export, SQLite backup/restore, task-volume reporting, explicit legacy work-log minutes, one-time legacy JSON import/archive, SQL integrity, and foreign-key checks.
- Latest sandbox measurements for 160 sequential task writes: **2,412 ms**; bootstrap **6 ms**; weekly report **4 ms**; monthly activity report **30 ms**. These are single-run sandbox results, not capacity targets.
- `npm audit` and `npm audit --omit=dev` — zero reported vulnerabilities at validation time.
- `npm ls --depth=0` — all declared top-level dependencies resolve to manifest/lockfile versions; package engine is `>=22.13.0`.
- `git diff --check` — passed. Build validates the TSX app; JavaScript modules and validation scripts pass Node syntax checks.
- Production-init guard — fresh isolated initialization passed; second init returned exit 1 and left the database hash unchanged.
- Current Node runtime was v22.22.3. `node:sqlite` worked and emitted Node's expected experimental warning.

The Electron 44.5.1 release metadata reports bundled Node 24.21.0, which includes `node:sqlite` ([Electron release metadata](https://releases.electronjs.org/release/v44.5.1), [Node SQLite API](https://nodejs.org/api/sqlite.html)). The Electron binary download failed TLS certificate verification in this environment, so actual Electron main-process/package launch and SQLite access remain unverified. Do not disable TLS verification to retry; use a valid CA setup or a cached Electron binary.

## Outstanding risks and product decisions

| Priority | Status | Finding / impact | Recommendation |
| --- | --- | --- | --- |
| **High** | Confirmed behavior; intended scope unclear | Users with `viewReports` can request all-person activity reports. Authenticated bootstrap includes workspace people, tasks, projects, activity, and alerts. The persisted `reportingPermissions` map is not enforced. | Decide whether workspace-wide visibility is intended; otherwise define and enforce server-side data/report scopes before production use. |
| **High** | Confirmed limitation | `moduleAccess`, `fieldAccess`, `actionAccess`, `exportPermissions`, and `reportingPermissions` are configuration metadata, not runtime authorization policy. Role permission arrays are enforced. | Do not treat these maps as security controls; define their schema/semantics before implementing them. |
| **High** | Confirmed limitation | Configured workflow transitions, approval steps, and automated actions are not enforced. Task permission checks allow movement to any configured state. | Confirm whether transition/approval enforcement is required and define exception/override behavior. |
| **Medium** | Confirmed limitation | Custom-field visibility/permissions and arbitrary validation expressions are not server-enforced. Required fields and basic scalar types are enforced; attachment/calculated/multi-select fields are not full runtime controls. | Treat unsupported field metadata as non-security behavior until a supported server-side type/validation contract is defined. |
| **Medium** | Confirmed limitation | Notification preferences, webhooks/integration registry, and some report/localization metadata are stored but do not execute delivery/automation. | Do not promise delivery, retries, or automation until event handling and secret lifecycle exist. |
| **Medium** | Deployment constraint | The database is SQLite, but Atlas keeps a full snapshot in each process and rewrites/upserts that snapshot per persistence operation. Concurrent Atlas instances can overwrite each other from stale memory; synchronous `DatabaseSync` can block on large writes. | Run one process per data directory. Benchmark realistic maximum workspace size; choose a different read/write architecture before multi-instance/high-concurrency deployment. |
| **Medium** | Runtime status | `node:sqlite` is experimental in Node 22 and release-candidate in Node 24. It is available in the configured Node/Electron versions, but the packaged Electron process was not launched in this environment. | Keep supported runtime versions explicit and make an Electron startup/CRUD/restore test a release gate. |
| **Medium** | Security limitation | SQLite files/backups are not application-encrypted at rest. POSIX data directories/database/backups receive restrictive permissions, but file permissions do not replace disk encryption. | Use OS/disk encryption and protected off-device backups where data sensitivity requires them. |
| **Medium** | Confirmed identity limitation | Authentication is local email/password with in-memory sessions; MFA/SSO, external identity lifecycle, and persistent shared sessions are not implemented. | Confirm local-only auth is acceptable before exposing sensitive data. |
| **Medium** | Deployment configuration | Atlas does not terminate HTTPS; secure cookies and proxy IP parsing depend on correct trusted-proxy configuration. | Terminate TLS at a trusted proxy, set `ATLAS_COOKIE_SECURE=true`, configure exact `ATLAS_TRUST_PROXY_HOPS`, and restrict network access. |
| **Medium** | Confirmed limitation | PWA caching covers the static shell/assets only; API data and writes are not cached or synchronized offline. | Treat the app as online-required for workspace operations. |
| **Low** | Manual verification outstanding | No browser automation or real-browser accessibility/printing/RTL-PDF test suite is present. | Complete browser/device acceptance against supported browsers and assistive technologies. |

## Deployment safety

- Back up the complete data directory before migration or upgrade. The JSON source is retained in `legacy/` after import, but backups and archives should also be copied off-device when required.
- Do not run `npm run init:production` as an upgrade step. It refuses existing data unless the deliberately destructive `ATLAS_FORCE_INIT_PRODUCTION=true` override is set.
- Legacy JSON backups are not active SQLite databases. Import them into a separate empty test data directory first; inspect integrity and records before changing the production data path.
- Electron packaging/signing, cross-platform data paths, and packaged SQLite access remain release gates.
