# Full Interface Translation Update

_Last updated: 2026-10-02_

## Scope and behavior

Atlas supports English, Arabic, Persian, and Hebrew. The language can be selected during first-run setup and changed after sign-in; RTL direction follows Arabic, Persian, and Hebrew. The account-level language choice is stored by the authenticated preferences API in SQLite and can be queued by the offline client.

The lookup-based localization runtime applies registered translations to interface text, including text nodes, buttons, labels, placeholders, titles, ARIA labels, select-option labels, setup/login, navigation, dashboards, entity pages, filters, export/print controls, settings, profile, user management, and offline-sync UI. Select option values, IDs, user-authored text, proper names, and unknown extension copy are not machine-translated. Unknown phrases remain in their source language until an explicit catalog translation is supplied.

The current catalog contains **1,047 distinct source phrases**. Its tests verify uniqueness, registered translations in Arabic/Persian/Hebrew, RTL behavior, reverse switching, and preservation of user-entered text. The only untranslated registered entries are intentional technical/product literals: `PDF`, `Excel`, `CSV`, `JSON`, `Esc`, `⌘K`, configuration-key examples, a sample internal URL, and the Atlas product name (Atlas remains untranslated in Hebrew as well). This is measurable coverage of the registered catalog, not a claim that every future or unregistered hard-coded string is translated.

## Changes in this update

- Added first-run language selection before workspace initialization; the chosen language becomes the workspace default.
- Expanded the built-in phrase catalog across the setup and application UI, including profile, administrator user management, and the persistent top-bar language switch.
- Corrected **Task board** as a task-tracking board in all enabled languages; removed an exact duplicate phrase row rather than adding another copy.
- Preserved entered profile values and other dynamic/user-authored text rather than translating content merely because it contains an interface phrase.
- Retained language-aware date, count, number, and status formatting where the interface uses the localization helpers.
- Updated the service-worker static-shell cache identifier to `atlas-local-v8-offline-shell` so updated assets are not served from the previous shell cache.

## Offline boundary

The service worker caches the static application shell/assets. Separately, the API client keeps selected per-user API responses and supported queued mutations in IndexedDB. That separate offline layer does not make every API response or operation available offline, and browser storage can still be cleared or evicted. See the offline-storage notes in the [Developer Guide](DEVELOPMENT.md) and [Build and Deployment Guide](BUILD_AND_DEPLOYMENT.md). Do not clear browser site data while edits are waiting to synchronize.

## Current verification

- `npm run test:unit` — passed, including localization-catalog, RTL/runtime, API/offline-sync, and table behavior tests.
- `npm run build` — passed. Vite emitted a chunk-size warning for a client chunk above 500 kB; this was not a build failure.
- `node scripts/final-validation.mjs` — **43/43 checks passed**; the report includes a 50,000-task benchmark. The detailed record is [`audit-validation-results-2026-10-02.json`](audit-validation-results-2026-10-02.json).
- `npm audit --omit=dev` — zero production dependency vulnerabilities.
- Full `npm audit` — reports **8 high-severity findings in the Electron packaging/build dependency tree**, including `http-cache-semantics` via `electron-builder`/`@electron/get`; these are dev dependencies, not the production web dependency tree. The issue remains a packaging-toolchain risk and should be rechecked before a desktop release ([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)).
- The production build preview started in production-safe first-run mode. `GET /api/auth/me` returned `401 {"error":"Sign in to continue"}` while signed out, which is the expected protected-route response; `/api/setup/status` returned `200` with no demo credentials. The production HTML, application entry, CSS, and `rolldown-runtime-hePW80VL.js` module-preload asset all returned `200`. The entry bundle imports that runtime chunk; the generated preload is not an unused standalone resource by the inspected bundle graph.

No real-browser automation is installed in this workspace, so a browser console warning about preloading could not be reproduced or cleared here. If it persists in a real browser, capture its console line and the matching network request. Visual review of all four languages, keyboard/screen-reader behavior, print/PDF layout, and cross-browser cache behavior remain manual acceptance work; build and catalog tests do not prove those properties.

## Operator note

A normal reload after deployment lets the service worker activate the updated shell. Development startup also unregisters the app's service worker and clears only its versioned shell caches. Neither procedure should be replaced by clearing all site data while an offline outbox is pending.
