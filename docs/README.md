# Atlas Workspace Documentation

This directory is the complete operating and development reference for Atlas Workspace.

## Core documents

1. [Atlas Workspace Manual](ATLAS_WORKSPACE_MANUAL.md) — complete product, operation, build, development, deployment, and functionality reference.
2. [Design System and Interface Standards](DESIGN_SYSTEM.md) — mandatory design principles, tokens, accessibility rules, interaction rules, and interface review checklist.
3. [Database Architecture](DATABASE_ARCHITECTURE.md) — embedded local database model, schema, entity relationships, validation, persistence, backup, migration, and recovery rules.
4. [API Reference](API_REFERENCE.md) — route inventory, permissions, request/response contracts, and report payloads.
5. [Developer Guide](DEVELOPMENT.md) — local development setup, project structure, coding standards, validation workflow, and extension rules.
6. [Build and Deployment Guide](BUILD_AND_DEPLOYMENT.md) — production web build, desktop packaging, environment variables, and release validation.
7. [Operations Runbook](OPERATIONS_RUNBOOK.md) — first-run setup, administration, backup/restore, troubleshooting, security, and maintenance.
8. [Functionality Reference](FUNCTIONALITY_REFERENCE.md) — screen-by-screen product behavior, reporting, exporting, roles, and workflows.
9. [Configuration, Internationalization, and Extensibility](CONFIGURATION_I18N_EXTENSIBILITY.md) — front-end administration, i18n/RTL, modules, custom fields, workflow/permission extensibility, and quality rules.
10. [Final Acceptance Report](FINAL_ACCEPTANCE_REPORT.md) — final functional audit, role journeys, Arabic/RTL validation, data integrity, production build, desktop packaging, and known limitations.

## Production posture

Atlas is maintained as one Node.js application with a TSX React interface, local-only fonts/assets, an embedded schema-versioned data store, role-enforced API routes, and Electron desktop packaging. Production first-run mode creates no demo credentials and no sample business data.
- [Configuration and Setup Advancement Report](CONFIGURATION_SETUP_ADVANCEMENTS.md) — advanced first-run setup and full Settings console improvements.
- [Field Entry and Configuration Layout Fix](FIELD_ENTRY_CONFIGURATION_FIX.md) — resolves field reset/stale-cache behavior and documents modern configuration field layout changes.
- [Full Interface Translation Update](FULL_INTERFACE_I18N_UPDATE.md) — setup-first language selection and full UI text localization coverage.
- [Advanced Translation System Architecture](TRANSLATION_SYSTEM_ARCHITECTURE.md) — frontend runtime API, namespace registry, translation endpoints, and integration guidance.
