# Decisions and open questions

These are things the repository cannot answer: product intent, policy, legal and commercial choices. No brief or requirements
document was available, so the README, PRODUCTION.md and the docs were treated as the stated objectives. For each item below
the code currently does the **conservative default** shown; none of them was invented as a requirement. Change the default by
deciding.

## Product and governance

| #   | Question                                                                                                                                                                                                         | Why it matters                                                                                                                                                           | What the code does until it is decided                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **What is Atlas for, and for whom?** (original brief, personas, non-goals, success measures)                                                                                                                     | The product describes itself as "engineering operations", "project management", "performance reporting" and "local-first desktop app" at once.                           | Treated as a single-workspace, self-hosted team tool. Nothing was added to widen it.                                                                                                                                                                |
| D2  | **Purpose of per-person activity reports.** Team awareness, or evaluating people? Is a works council / DPIA / consent process required where you operate?                                                        | Per-person monitoring is regulated in many jurisdictions (e.g. GDPR, German works-council law). Atlas used to also show invented "minutes", which could mislead reviews. | Per-person activity is limited to managers and administrators; everyone sees their own (`reports.activityVisibility = managers`). Effort minutes no longer exist. An administrator can widen it. **Decide before using the reports in appraisals.** |
| D3  | **Retention and erasure.** How long to keep the audit trail (default 365 days) and the work ledger (default forever)? How to honour access/erasure requests?                                                     | The ledger names people and what they did. Deleting a person keeps their ledger rows as "Former member".                                                                 | Audit entries expire (`audit.retentionDays`, min. 30). Ledger rows kept unless `audit.workLogRetentionDays` is set. There is no per-person export or erasure tool.                                                                                  |
| D4  | **Metric definitions.** Is "on-time delivery = completed on or before the due date, among tasks that have come due" the right definition? Should re-planned due dates count against it?                          | Reports used to divide completions by creations (rates above 100%). The definition is now explicit but still a choice.                                                   | Definitions are shown on the Reports screen and returned by the API (`definitions`). Due dates are read as currently recorded (editing a due date re-plans history for that metric).                                                                |
| D5  | **Time tracking.** Is real time/effort tracking wanted?                                                                                                                                                          | The old ledger fabricated minutes from fixed constants (20/25/45/90 per event). They were removed rather than relabelled.                                                | No time-spent figures. A real feature would need time entries entered by people.                                                                                                                                                                    |
| D6  | **Who may re-plan a task?** Current rule: anyone with `writeTasks` moves tasks through the workflow; title/project/assignee/priority/type/due date need `manageTasks` or ownership (assigned or created by you). | The role text says Developers "update task progress"; the code used to let them rewrite anyone's task.                                                                   | The rule above, documented in `docs/SECURITY.md`.                                                                                                                                                                                                   |
| D7  | **Roles beyond the four defaults.** Can a custom role hold `manageUsers`? (It is allowed, but nobody can grant a role that outranks their own.)                                                                  | Delegated user administration.                                                                                                                                           | Allowed, rank-limited. Role ranks: Viewer 1, Developer 2, Manager 3, Administrator 4; custom roles default to 2.                                                                                                                                    |

## Security and identity

| #   | Question                                       | Why it matters                                                                          | Until decided                                                                                                                 |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D8  | **SSO / MFA / account recovery by e-mail?**    | Local passwords only is acceptable for a small team on a VPN, not for wider exposure.   | Local accounts, strong hashing, lockout, forced change of admin-set passwords. Recovery via the CLI (`admin:reset-password`). |
| D9  | **Security contact and disclosure policy.**    | `docs/SECURITY.md` has no named contact.                                                | "Report privately to the repository owner."                                                                                   |
| D10 | **Is public-internet exposure ever intended?** | It would need MFA, request rate limiting, a WAF/proxy policy and external log shipping. | Documented as not recommended.                                                                                                |

## Platform and packaging

| #   | Question                                                                                                                                    | Why it matters                                                                                                                  | Until decided                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D11 | **Scale target** (tasks, users, concurrent editors) and **storage engine.**                                                                 | The JSON store is rewritten whole on each change and the browser loads everything. About 10,000 tasks is the comfortable limit. | JSON store hardened (atomic, fsync, lock, rollback, backups). A migration to SQLite (or server-side pagination) is the next step if the target is larger. It was not done because the target is unknown and a native/embedded database cannot be verified inside Electron here. |
| D12 | **Offline/PWA requirement.** Remove the manifest and service worker, or build a real offline mode (local replica, sync, conflict handling)? | All data lives on the server. "Offline" claims were not true.                                                                   | The worker caches static assets and shows an explanatory page. No offline data. Installable via the manifest.                                                                                                                                                                   |
| D13 | **Desktop distribution**: platforms, code-signing certificates, auto-update channel, final `appId`.                                         | Unsigned installers trigger SmartScreen/Gatekeeper warnings; changing `appId` after release breaks upgrades.                    | Placeholder `ai.arena.atlasworkspace`, no signing, no updater. Icons were generated from `public/atlas-icon.svg` (`build/`).                                                                                                                                                    |
| D14 | **Project name, ownership, licence.** There is no `LICENSE`; fonts are DejaVu Sans (licence text in `THIRD_PARTY_NOTICES.md`).              | Contributors and users need to know their rights.                                                                               | "All rights reserved" by default; `package.json` has `private: true` and no `license`.                                                                                                                                                                                          |

## Settings that exist but do nothing

The Settings console can store values that Atlas does not read. They are now shown disabled with a **Not applied yet** badge.
Decide for each group whether to build it or remove it:

- notifications (in-app/e-mail/webhook channels and events) and integrations (registry, webhooks, API access);
- workflow approval steps and automated actions;
- working days, working hours, holidays;
- field-level, module, action, export and reporting permission maps; "require approval for role changes";
- number/currency/date/time-zone display formats per language, regional date pattern, typography and spacing, table column and
  form layout customisation, report footer, custom report columns/filters/calculations, logo and branding paths, organisation
  details.

Settings that _are_ now applied (they were inert before): password minimum length, session duration, audit
(enabled/retention/track reads/writes/exports), export formats and PDF defaults, print/export action visibility, per-user
language preference, configuration import/export switch, workflow transition enforcement (new, off by default), week start day
(new) and per-person activity visibility (new).

## Content that needs a human

- **Translations.** Arabic, Persian and Hebrew phrases (about 570 per language) were written without native-speaker review,
  including the ones added in this release. About 125 interface strings (mostly settings-console explanations) have no
  translation and fall back to English.
- **Accessibility.** Keyboard operation, labels, focus visibility, colour contrast of secondary text, reduced motion and
  dialog semantics were fixed and are covered by automated DOM checks. **No screen-reader or real-browser audit has been
  performed**, and some text is still set at 9-11 px. Choose a target (WCAG 2.2 AA is the usual one) and test with real users.

## Process

- **Branch protection / required reviews / release process** are not configured here. CI (`.github/workflows/ci.yml`) is in
  the repository but could not be run in the environment used for this release.
- **The original validation script** (`scripts/final-validation.mjs`) was replaced by `tests/acceptance/` (and its tracked
  results file removed) because it passed on a build with three critical flaws.
