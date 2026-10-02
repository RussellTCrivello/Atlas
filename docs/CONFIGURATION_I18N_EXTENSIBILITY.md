# Configuration, Internationalization, and Extensibility Architecture

## Purpose

Atlas Workspace is now structured as a configurable operations platform rather than a fixed application. Organizations can administer workspace identity, interface behavior, languages, translations, modules, workflows, permissions, reports, exports, integrations, storage, security, audit, and custom fields through the Settings interface.

The objective is to let organizations adapt Atlas to different industries, cultures, languages, team structures, and operational models without editing source code for routine changes.

## Administration principle

All essential operational configuration is stored as versioned settings data and managed from **Settings → Administration**.

The Settings page includes administration areas for:

- Platform foundation
- Workspace settings
- Interface settings
- Language and localization
- Translation management
- Navigation and modules
- Workflow customization
- Permission extensibility
- Custom fields
- Reports and exports
- Notifications and integrations
- Storage, security, audit, and maintenance
- Configuration import/export

## Configuration storage model

Settings are persisted in the embedded store under the `settings` branch and normalized on load/save.

Top-level configuration branches:

```txt
settings
├── workspace
├── interface
├── localization
├── modules
├── workflows
├── customFields
├── permissions
├── notifications
├── reports
├── exports
├── integrations
├── storage
├── security
└── audit
```

The active store schema is `3.0.0` and the design-system version is `2.0.0`.

Backward-compatible flat properties are still normalized for legacy UI surfaces:

- `workspaceName`
- `workspaceUnit`
- `language`
- `density`
- `dateFormat`
- `defaultTaskView`
- `pageSize`
- `printTemplate`
- `theme`
- `accentColor`
- `sidebarMode`
- `defaultPage`
- `showAnimations`
- `enabledPages`

## Workspace settings

Administrators can configure:

- Workspace name
- Unit/department
- Application name
- Logo/brand asset path
- Organization legal name
- Contact email
- Default timezone
- Default language
- Regional date/number/currency settings
- Working days
- Working hours
- Holidays

The configured timezone is used by server-side current-date and activity-time helpers.

## Interface settings

Administrators can configure:

- Theme: light, dark, system
- Accent color
- Density
- Spacing
- Typography scale
- Sidebar behavior
- Default landing page
- Table page size
- Motion
- High contrast
- Reduced motion

The browser applies language, text direction, density, sidebar, motion, and contrast settings dynamically without rebuilding.

## Internationalization

### Unicode support

Atlas stores and reports Unicode text. Production smoke validation covered Arabic person, project, and task names through project/task/activity report flows.

Supported multilingual areas include:

- Project names
- Task names
- People names
- Activity summaries
- Reports
- Exports
- Searchable interface records
- Translation catalogs

### Languages and direction

Initial language package support includes:

| Language | Code | Direction |
| --- | --- | --- |
| English | `en` | LTR |
| Arabic | `ar` | RTL |
| Persian | `fa` | RTL |
| Hebrew | `he` | RTL |

The interface dynamically sets `html.lang`, `html.dir`, and `body.dir` from localization settings.

RTL support includes:

- RTL shell direction
- RTL navigation alignment
- RTL forms
- RTL settings interface
- RTL table/form inputs for translation text
- RTL print/export metadata support through report/export settings

### Translation management

Settings includes a translation manager with:

- Translation key browser
- Search
- Missing translation count
- Key creation
- Per-language editing
- Language JSON export
- Fallback language
- Active language list
- Translation approval workflow toggle

Translation storage example:

```json
{
  "localization": {
    "translations": {
      "en": {
        "settings.projects.create_button": "Create Project"
      },
      "ar": {
        "settings.projects.create_button": "إنشاء مشروع"
      }
    }
  }
}
```

## Dynamic interface composition

Administrators can enable or disable core modules through Settings:

- Overview
- Projects
- Tasks
- People
- Activity
- Reports
- Alerts

The navigation list derives from configuration. Disabled modules are removed from navigation without code changes.

Dashboard layout metadata is stored under:

```txt
settings.interface.dashboardLayouts
```

Table/card behavior is stored under:

```txt
settings.interface.tableBehavior
settings.interface.cardLayouts
```

## Module architecture

Core module metadata is stored under `settings.modules`.

Each module can declare:

- enabled state
- label key
- icon
- permissions

This is the foundation for future modules to register:

- metadata
- navigation entries
- permissions
- database entities
- API routes
- UI surfaces
- reports
- settings
- translations

## Custom fields framework

Administrators can define custom fields for:

- projects
- tasks
- people
- teams
- activities
- alerts
- reports

Supported field types:

- text
- number
- date
- datetime
- checkbox
- dropdown
- multi-select
- user
- attachment
- url
- calculated

Each definition can include:

- key
- label
- type
- visibility
- required flag
- permissions metadata

Runtime forms render configured fields for supported record types and APIs persist `customFields` on major entities.

Example task payload:

```json
{
  "title": "Contract review",
  "status": "Manager Approval",
  "customFields": {
    "client_reference": "C-42"
  }
}
```

## Workflow customization

Task workflow states are now settings-driven.

Default workflow:

```txt
To do → In progress → Review → Testing → Done
```

Administrators can replace it with custom states, for example:

```txt
Draft → Manager Approval → Legal Review → Published
```

Workflow settings include:

- workflow name
- states
- state colors
- terminal state flag
- transitions
- approval steps
- automated actions

The task board, task modal, and status API use configured workflow states.

## Permission extensibility

Roles are stored under:

```txt
settings.permissions.roles
```

Administrators can add custom roles and configure action permissions.

Permission checks exist in:

- UI rendering
- API route middleware
- Backend authorization helpers

The server uses configured role permissions and falls back to built-in role defaults only when a configured role does not exist.

## Branding and themes

Branding configuration includes:

- application name
- logo path
- primary color
- accent color
- report logo
- login headline
- report/export branding flag

Theme and interface preferences are applied dynamically through settings and CSS variables.

## Reporting and export extensibility

Reports and exports are governed by:

```txt
settings.reports
settings.exports
```

Administrators can configure:

- default template
- available templates
- enabled export formats
- localized report output
- direction-aware exports
- branding in exports

Current export formats remain:

- CSV
- Excel
- JSON
- PDF
- Print

## Notifications and integrations

Configuration branches exist for:

- notifications
- notification channels
- notification events
- integration registry
- webhooks/API-access metadata

These branches are administered through Settings and document extension points for future integration implementation.

## Storage, security, audit, and maintenance

Settings and system administration include:

- database model
- schema version
- backup retention
- import/export enablement
- password minimum length
- session length
- audit enabled flag
- audit retention
- backup creation
- integrity status
- collection counts

The `/api/system/backup` endpoint creates an administrator-triggered backup and records an audit event.

## Quality rules for future features

A feature is incomplete until it includes:

- settings integration
- permission integration
- localization keys
- accessibility behavior
- report/export handling when operationally relevant
- migration/normalization support
- documentation updates
- smoke-test validation

