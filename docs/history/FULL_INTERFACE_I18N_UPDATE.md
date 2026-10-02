# Full Interface Translation Update

> **Historical record.** This is a point-in-time report written against an earlier version of Atlas. It is kept for context
> only and is **superseded** by [`PRODUCTION.md`](../../PRODUCTION.md), [`SECURITY.md`](../SECURITY.md),
> [`DATABASE_ARCHITECTURE.md`](../DATABASE_ARCHITECTURE.md) and [`API_REFERENCE.md`](../API_REFERENCE.md). Claims about validation,
> security, translation coverage or "live" behaviour below describe that earlier version and were not true of every code path
> (see [`AUDIT_REPORT_2026-10-02.md`](../AUDIT_REPORT_2026-10-02.md)).

_Last updated: 2026-10-01_

## Requirement addressed

Atlas must support translation across all visible interfaces, including setup screens, login, navigation, dashboards, buttons, input labels, placeholders, configuration panels, workflows, permissions, reports, exports, integrations, and system maintenance controls. Language selection must be available at the beginning of setup and must apply to both the setup experience and the configured application.

## Implemented changes

### 1. Setup language selection from the beginning

The first-run setup screen now includes an **Interface language** selector in the setup side panel. It is available immediately on the first setup step, before the workspace is initialized.

Changing this language updates:

- setup headings and instructions
- setup buttons
- input labels
- select labels
- setup summaries
- document `lang`
- document/text direction (`ltr` / `rtl`)

The selected setup language is included in the generated settings package and becomes the default application language after initialization.

### 2. Full-interface localization runtime

A front-end localization runtime was added to support existing and future static UI text without requiring a rebuild for normal language switching. It translates:

- text nodes
- buttons
- labels
- placeholders
- titles
- ARIA labels
- select option labels while preserving original option values
- setup screens
- login screen
- dashboards
- project/task/person/activity/report/alert screens
- modals
- advanced filters
- export/print controls
- Settings/configuration screens

It also supports reverse translation when switching back to English or between RTL languages.

### 3. Translation catalog expansion

The default front-end translation catalog now contains an expanded UI phrase registry for:

- English
- Arabic
- Persian
- Hebrew

Translation keys are generated as `ui.*` keys and are included in the settings catalog so administrators can view and override them through the Translation Manager.

### 4. RTL behavior

Arabic, Persian, and Hebrew continue to switch the document and body direction to RTL dynamically. This applies to setup, login, settings, navigation, tables, forms, reports, exports, and modal interfaces.

### 5. Service worker cache update

The service worker cache was bumped to:

`atlas-local-v5-translation-runtime`

This ensures users receive the updated localized UI instead of stale cached bundles.

## Validation

Completed successfully after implementation:

- `npm run build`
- `node scripts/final-validation.mjs`
- `npm audit --omit=dev`
- `npm audit`

Latest final-validation status: 23 checks passed, 0 failures.

## Notes for operators

If a browser has the earlier local service worker cached, perform one hard refresh after deployment. The new service worker will activate and remove old caches.
