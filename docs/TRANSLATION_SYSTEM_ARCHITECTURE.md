# Advanced Translation System Architecture

> **Partly out of date.** Written before the remediation release (store schema 3.1.0). Where it disagrees with
> [`PRODUCTION.md`](../PRODUCTION.md), [`SECURITY.md`](SECURITY.md), [`API_REFERENCE.md`](API_REFERENCE.md) or
> [`DATABASE_ARCHITECTURE.md`](DATABASE_ARCHITECTURE.md), those win. Known differences: effort **minutes no longer exist** (the old
> figures were fixed constants, not measurements); setup requires a one-time token; the interface localiser never rewrites
> user-entered data and each person can choose a language and theme for themselves; settings labelled "Not applied yet" are stored
> but do nothing; workspace data is no longer sent in full to every role.

_Last updated: 2026-10-01_

## Purpose

Atlas now includes a deeper translation architecture intended for the entire product surface and for future or custom frontend interfaces. The system is designed around a versioned settings-backed catalog, runtime language switching, extensible namespaces, missing-key detection, translation approval metadata, RTL/LTR switching, and simple frontend integration APIs.

## Core capabilities

- Setup-first language choice before workspace initialization.
- Runtime language switching for the configured application.
- Full UI text translation coverage through the front-end localization runtime.
- DOM localization for static text, labels, buttons, placeholders, titles, ARIA labels, and select option labels.
- Preservation of form values and select option values while translated labels are displayed.
- Built-in language packages for English, Arabic, Persian, and Hebrew.
- Dynamic RTL/LTR document direction.
- Settings-managed translation catalog and administrator overrides.
- Translation approval status per key.
- Missing-key detection and logging.
- Translation memory metadata.
- Interface namespace registry for custom screens/modules.
- Public catalog read endpoint for setup/custom frontends.
- Admin registration endpoints for custom interface translation packages.

## Runtime frontend API

The application publishes a global runtime object when the UI loads:

```js
window.AtlasI18n
```

It is refreshed whenever the workspace language/settings change and dispatches:

```js
window.addEventListener('atlas:i18n-ready', event => {
  const i18n = event.detail.i18n
})
```

### Common usage

```js
window.AtlasI18n.t('billing.invoice_due', 'Invoice {number} is due', {
  number: 'INV-42'
})
```

### Phrase-based usage

```js
window.AtlasI18n.phrase('Save')
window.AtlasI18n.phrase('Workspace administration')
```

### Formatting helpers

```js
window.AtlasI18n.formatDate(new Date())
window.AtlasI18n.formatNumber(123456.78)
window.AtlasI18n.formatCurrency(2500, 'EUR')
```

### Pluralization

```js
window.AtlasI18n.plural(
  'tasks.count',
  count,
  {
    one: '{count} task',
    other: '{count} tasks'
  },
  { count }
)
```

### Register an interface package from a frontend extension

```js
await window.AtlasI18n.registerInterface(
  'billing',
  {
    en: {
      'billing.invoice_due': 'Invoice {number} is due'
    },
    ar: {
      'billing.invoice_due': 'الفاتورة {number} مستحقة'
    },
    fa: {
      'billing.invoice_due': 'فاکتور {number} سررسید دارد'
    },
    he: {
      'billing.invoice_due': 'חשבונית {number} לתשלום'
    }
  },
  {
    label: 'Billing',
    version: '1.0.0',
    owner: 'Finance',
    route: '/billing'
  }
)
```

## Backend translation APIs

### `GET /api/i18n/catalog`

Returns the active translation catalog. Optional query:

```txt
/api/i18n/catalog?language=ar
```

Payload includes:

- language
- fallback language
- direction
- merged catalog
- fallback catalog
- active languages
- language packages
- interface registry
- key policy
- runtime settings

This endpoint is public so setup and custom frontends can load language metadata before authentication.

### `POST /api/i18n/register`

Admin-only. Registers a namespace/interface translation package.

```json
{
  "namespace": "billing",
  "translations": {
    "en": {
      "billing.invoice_due": "Invoice {number} is due"
    },
    "ar": {
      "billing.invoice_due": "الفاتورة {number} مستحقة"
    }
  },
  "metadata": {
    "label": "Billing",
    "version": "1.0.0",
    "owner": "Finance",
    "route": "/billing"
  }
}
```

### `PUT /api/i18n/translation`

Admin-only. Upserts one translation key and approval status.

```json
{
  "language": "ar",
  "key": "billing.invoice_due",
  "value": "الفاتورة {number} مستحقة",
  "status": "approved"
}
```

### `POST /api/i18n/bulk`

Admin-only. Bulk-imports resource catalogs.

```json
{
  "translations": {
    "en": {
      "custom.key": "Custom text"
    },
    "he": {
      "custom.key": "טקסט מותאם"
    }
  }
}
```

### `POST /api/i18n/missing`

Records a missing key observed by a frontend runtime. This endpoint is intentionally safe during setup and only persists when the workspace is configured.

```json
{
  "language": "fa",
  "key": "custom.missing_key",
  "fallback": "Missing fallback",
  "source": "frontend-runtime"
}
```

### `GET /api/settings/translations/missing`

Admin-only. Returns missing translation keys by language, including total count.

## Settings console integration

The Settings → Localization area now includes an **Interface integration** panel with:

- catalog key count
- active language count
- registered interface count
- missing translation count
- namespace registry
- namespace creation
- developer integration snippet
- missing-key log editor
- translation memory editor
- key policy editor
- runtime controls editor

## Settings model additions

The localization settings branch now includes:

```json
{
  "interfaces": {
    "core": {
      "namespace": "core",
      "label": "Core application",
      "status": "active"
    }
  },
  "missingKeys": [],
  "translationMemory": [],
  "keyPolicy": {
    "prefixByNamespace": true,
    "fallbackRequired": true,
    "approvalRequired": true
  },
  "runtime": {
    "domLocalization": true,
    "attributeLocalization": true,
    "optionLocalization": true,
    "reportMissing": true
  }
}
```

## Developer guidance

- Use namespace-prefixed keys for every custom interface: `moduleName.component.element`.
- Always provide an English fallback.
- Register custom interface catalogs through `/api/i18n/register`.
- Use `window.AtlasI18n.t()` for dynamic UI strings.
- Use `window.AtlasI18n.formatDate`, `formatNumber`, and `formatCurrency` instead of hard-coded browser defaults.
- Avoid translating user-entered values, identifiers, codes, or data fields unless they are explicit labels.
- Use `translate="no"` (or `data-no-i18n`) on code samples, technical IDs, templates, or editable content that must remain literal.
- For RTL languages, rely on the document-level direction set by Atlas instead of hard-coding directional styles.

## Validation

The translation architecture was validated with:

- production build
- setup smoke tests
- final validation suite
- audit checks

## Immediate language switching note

The interface now uses a centralized application-level language preview state. Earlier iterations could appear delayed because setup/settings language selections lived inside local draft forms, while the application-level localization observer still used the persisted workspace settings until Save. The current implementation promotes the selected language to the active UI localization layer immediately, then persists it when settings/setup are saved.

Behavior:

- First-run setup language changes apply immediately to the setup UI.
- Settings → Localization → Default language applies immediately as a live UI preview.
- Saving Settings persists the selected language to the workspace configuration.
- Leaving Settings without saving clears the preview and returns to the persisted language.
