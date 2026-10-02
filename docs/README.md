# Atlas Workspace documentation

Start here:

| You are…                                 | Read                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installing or running a server           | [`../PRODUCTION.md`](../PRODUCTION.md), then [`OPERATIONS_RUNBOOK.md`](OPERATIONS_RUNBOOK.md)                                                                            |
| Reviewing security                       | [`SECURITY.md`](SECURITY.md)                                                                                                                                             |
| Contributing code                        | [`DEVELOPMENT.md`](DEVELOPMENT.md), [`DATABASE_ARCHITECTURE.md`](DATABASE_ARCHITECTURE.md), [`API_REFERENCE.md`](API_REFERENCE.md)                                       |
| Building releases and desktop installers | [`BUILD_AND_DEPLOYMENT.md`](BUILD_AND_DEPLOYMENT.md)                                                                                                                     |
| Deciding what to build or change next    | [`DECISIONS_AND_OPEN_QUESTIONS.md`](DECISIONS_AND_OPEN_QUESTIONS.md)                                                                                                     |
| Wanting the history of this release      | [`../CHANGELOG.md`](../CHANGELOG.md), [`AUDIT_REPORT_2026-10-02.md`](AUDIT_REPORT_2026-10-02.md), [`REMEDIATION_REPORT_2026-10-02.md`](REMEDIATION_REPORT_2026-10-02.md) |

## Reference (partly out of date, see the note at the top of each)

- [`ATLAS_WORKSPACE_MANUAL.md`](ATLAS_WORKSPACE_MANUAL.md): product manual.
- [`FUNCTIONALITY_REFERENCE.md`](FUNCTIONALITY_REFERENCE.md): screen-by-screen behaviour.
- [`CONFIGURATION_I18N_EXTENSIBILITY.md`](CONFIGURATION_I18N_EXTENSIBILITY.md) and
  [`TRANSLATION_SYSTEM_ARCHITECTURE.md`](TRANSLATION_SYSTEM_ARCHITECTURE.md): configuration, localisation, extension API.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): design principles and tokens.

## History

[`history/`](history/) holds point-in-time reports from earlier versions (final acceptance, setup and i18n updates, UI
refinement). They are kept for context and are superseded by the documents above.

## What Atlas is, and is not

Atlas is one Node.js process serving a React interface and a JSON API, with an embedded, schema-versioned, crash-safe data
store, local-only assets and an optional Electron shell. It is built for one workspace on one machine or small server; see
the scope and limits in the [README](../README.md#scope-and-limits).
