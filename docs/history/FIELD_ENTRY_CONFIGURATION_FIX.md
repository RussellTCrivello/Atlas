# Field Entry and Configuration Layout Fix

> **Historical record.** This is a point-in-time report written against an earlier version of Atlas. It is kept for context
> only and is **superseded** by [`PRODUCTION.md`](../../PRODUCTION.md), [`SECURITY.md`](../SECURITY.md),
> [`DATABASE_ARCHITECTURE.md`](../DATABASE_ARCHITECTURE.md) and [`API_REFERENCE.md`](../API_REFERENCE.md). Claims about validation,
> security, translation coverage or "live" behaviour below describe that earlier version and were not true of every code path
> (see [`AUDIT_REPORT_2026-10-02.md`](../AUDIT_REPORT_2026-10-02.md)).

_Last updated: 2026-10-01_

## Issue addressed

Users reported that content typed into setup/configuration fields appeared to be removed while typing and that forms did not reliably accept or save entered values.

## Fixes implemented

### 1. Stable settings section rendering

The Settings page previously created an inline `Panel` component inside `SettingsPage`. Inline component types can be recreated on every parent render, which can cause section subtrees to unmount/remount during configuration edits. That behavior is especially disruptive for rich configuration editors, draft fields, drag-and-drop builders, and JSON/text areas.

The settings section wrapper has been replaced with a stable top-level `SettingsSection` component. This prevents avoidable remounts while administrators type or edit configuration fields.

### 2. Modal form state preservation

The entity modal initialization effect was narrowed so typing in create/edit dialogs is not reset by unrelated data/settings refreshes. Form defaults still initialize when the modal opens or when the edited record changes, but they no longer reset from unrelated parent data changes.

### 3. Service worker cache refresh

The service worker cache was updated from an old cache strategy to a safer versioned strategy:

- New cache name: `atlas-local-v3-configuration-fields`
- HTML is fetched network-first with `no-store`
- Versioned assets and local fonts remain cacheable
- Old caches are deleted on activation

This prevents a browser from continuing to serve stale UI bundles after fixes are deployed.

### 4. Professional configuration field layout redesign

Configuration fields were restyled into a more modern, advanced administration layout:

- Card-like field containers
- Clear focus states
- Larger, more usable input controls
- Improved textarea and JSON editor presentation
- Professional admin toolbar styling
- Modern toggle cards
- Better drag handles for navigation/widgets/workflow/field ordering
- Stronger visual hierarchy for configuration rows
- Dark-theme-aware field surfaces
- Responsive two-column-to-one-column field grids

## Validation

The following validations passed after the fix:

- `npm run build`
- `node scripts/final-validation.mjs`
- `npm audit --omit=dev`
- `npm audit`

Latest final-validation result:

```json
{
  "checks": 23,
  "failures": 0,
  "metrics": {
    "create160TasksMs": 740,
    "bootstrapMs": 12,
    "weeklyReportMs": 10,
    "monthlyActivityReportMs": 48
  }
}
```

## User action if the old behavior persists

Because this issue may be amplified by an already-registered local service worker, refresh the running preview/app after the new build loads. If the browser still shows stale behavior, hard-refresh the page once so the updated service worker can activate and remove the old cache.
