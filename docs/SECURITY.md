# Security model

This document states what Atlas defends against, how, and what it does **not** defend against. Every control listed here has
an automated test (named in the last column); controls without a test are marked.

## Assumptions

- The server runs on a machine the operator controls. Anyone with read access to the data directory can read every password
  hash, session hash and all workspace data; anyone with write access can change them.
- Users are members of one organisation. There is no multi-tenancy.
- TLS is provided by a reverse proxy when anyone other than the local user connects (see `PRODUCTION.md`).

## Controls

| Threat                                                                | Control                                                                                                                                                                                                                                                                                         | Test                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Someone on the network claims or wipes the workspace via `/api/setup` | Setup needs a one-time token (random per start, or `ATLAS_SETUP_TOKEN`) and answers `409` once a workspace exists. Token guesses are throttled and audited. Empty/unreadable stores never reopen setup (fail closed).                                                                           | `setup-auth`, `store` (fail closed), acceptance |
| Development server leaks the data file or source                      | Loopback bind by default; Vite serves an explicit allow-list (`src`, `shared`, `public`, `node_modules`, `index.html`) and is unreachable with a foreign `Host`; HMR shares the HTTP port (no second socket).                                                                                   | `dev-server`                                    |
| Unauthenticated writes to the store                                   | `/api/i18n/missing` requires a session, is kept in bounded memory and never persisted. Every other write is authenticated, permission-checked and schema-validated.                                                                                                                             | `security`, `data`                              |
| Password guessing                                                     | scrypt (N=2^17, r=8, p=1, parameters stored per hash, legacy hashes upgraded on sign-in); async with ≤ 2 concurrent hashes; 30 attempts per 10 min per address; exponential per-account lockout (15 s … 15 min); unknown accounts cost the same as known ones.                                  | `setup-auth`                                    |
| Credential stuffing / weak passwords                                  | Length policy (min 8, `security.passwordMinLength` up to 128), deny-list of very common passwords, must not contain the e-mail name; strength preview in the UI.                                                                                                                                | `setup-auth`, `auth-errors`                     |
| Session theft or fixation                                             | 256-bit random tokens, only SHA-256 stored (`sessions.json`, mode 0600); new token on every sign-in; `HttpOnly`, `SameSite=Lax`, `Secure` behind HTTPS; lifetime `security.sessionDays` enforced server-side; revoked on logout, "sign out everywhere", password change/reset, disable, delete. | `setup-auth`                                    |
| Admin-chosen passwords known to the admin                             | Accounts created or reset by an administrator are flagged; every API except `/api/auth/*` answers `403 PASSWORD_CHANGE_REQUIRED` until the user sets their own password.                                                                                                                        | `setup-auth`, `auth-errors`                     |
| CSRF and DNS rebinding                                                | `SameSite=Lax` cookie, `Origin` must match `Host` on writes, `Host` allow-list (loopback names by default, `ATLAS_ALLOWED_HOSTS` otherwise).                                                                                                                                                    | `security`                                      |
| XSS and clickjacking                                                  | React escapes output; production CSP `default-src 'self'`, `script-src 'self' blob:` (no inline scripts), `frame-ancestors 'self'`, `object-src 'none'`; `X-Frame-Options`, `nosniff`, COOP/CORP, Permissions-Policy.                                                                           | `security`, acceptance                          |
| Privilege escalation                                                  | Permissions are evaluated on the server per request from the role registry. Nobody can grant, modify or delete a role that outranks their own; the last active administrator cannot be demoted, disabled or deleted; role names are own-property checked.                                       | `security`                                      |
| Over-sharing of data                                                  | `/api/bootstrap` is scoped by role: the account directory only for `manageUsers`; security, audit, integration, storage and role settings only for `manageSettings`. Per-person activity analytics are limited to managers unless an administrator opts in.                                     | `security`, `settings-reports`                  |
| Developers editing others' work                                       | Any writer can move a task through the workflow; re-planning (title, project, assignee, priority, type, due date) needs `manageTasks` or ownership (assigned to or created by the user).                                                                                                        | `data`                                          |
| Forged attribution                                                    | Activity updates are attributed to the signed-in person; posting for someone else needs `managePeople`. Ledger events record the actor, not the assignee.                                                                                                                                       | `security`, `data`                              |
| CSV/spreadsheet formula injection                                     | Cells starting with `= + - @` (tab, CR) are prefixed with an apostrophe (plain numbers excepted); XLSX text is written as inline strings.                                                                                                                                                       | `i18n-export`                                   |
| Data exfiltration through exports                                     | `exportData` is checked and the export audited server-side _before_ a file is generated. **Limit:** exports are built in the browser from data the user can already read; this deters and records, it cannot prevent copying.                                                                   | `i18n-export`                                   |
| Loss or silent corruption of data                                     | Atomic fsynced writes, rollback on failure, single-writer lock, daily and pre-risk backups, fail-closed start-up, validation of every request, referential-integrity checks, restore CLI.                                                                                                       | `store`, `data`, acceptance                     |
| Audit trail tampering or gaps                                         | Entries are hash-chained (`/api/system`, `/api/audit` verify); failed sign-ins, denials, exports, role/password/settings changes are recorded with actor, IP and user agent; security events are logged even when general audit logging is off.                                                 | `store`, `setup-auth`, `security`               |
| Malicious content opened by the desktop shell                         | Sandboxed, context-isolated window; navigation confined to the exact local origin; only `http(s)`/`mailto` handed to the OS; permission requests denied; no developer tools in packaged builds; minimal preload.                                                                                | `electron` (structural; GUI not launched)       |
| Prototype pollution, hostile JSON                                     | Safe merge helpers skip `__proto__`/`constructor`/`prototype`; settings and translations are sanitised; 1 MB body limit; JSON errors return JSON.                                                                                                                                               | `settings`, `security`                          |

## What Atlas does **not** protect against

- **A compromised server or an operator with file access.** The audit chain detects accidental damage and casual edits; someone
  who can rewrite the whole data file can recompute it. Ship the audit log off-box if that matters.
- **Authorised users copying what they can see.** Role scoping limits what is sent; it cannot stop a manager screenshotting.
- **Single sign-on, multi-factor authentication, password breach checks beyond the built-in common-password list, account
  recovery by e-mail.** An administrator or the CLI (`admin:reset-password`) resets passwords. This is an open decision.
- **Volumetric denial of service.** Sign-in is throttled and hashing is bounded; there is no general request rate limit. Use
  the reverse proxy (`limit_req`) if the service is reachable by untrusted networks.
- **Encryption at rest.** The store, sessions and backups are plain files (mode 0600/0700). Use disk encryption.
- **Client-side tampering**: the browser is untrusted, but the settings UI in a modified browser can still _display_ whatever
  the server returned for that role.
- **Supply chain**: dependencies are pinned by `package-lock.json`; `npm audit --omit=dev` runs in CI. There is no signature
  verification of dependencies and no signed releases or SBOM yet.
- **Desktop code signing/notarisation** (not done) and auto-update (not provided).

## Operator hardening checklist

1. Keep the default loopback bind; terminate TLS in a reverse proxy; set `ATLAS_TRUST_PROXY`, `ATLAS_ALLOWED_HOSTS`,
   `ATLAS_COOKIE_SECURE=true`.
2. Run as an unprivileged user with the data directory (`0700`) as the only writable path.
3. Back up `backups/` off the machine; test `restore:data` once.
4. Review **Settings, Security & audit** (password length, session days, retention) and **Reports** (who can see per-person
   activity).
5. Keep Node and dependencies updated (Dependabot is configured; Electron majors need a deliberate upgrade).
6. Treat the setup token like a password until setup is finished.

## Reporting a vulnerability

No security contact has been designated for this project yet. Until the owner names one, report issues privately to the
repository owner rather than in a public issue. (Open decision: see `DECISIONS_AND_OPEN_QUESTIONS.md`.)
