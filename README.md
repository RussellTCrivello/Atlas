# Atlas Workspace

Atlas is a local-first engineering operations workspace with professional navigation, drag-and-drop task boards, advanced filters, live dashboards, alerts, and customizable reports.

## Run

```bash
# Node.js 22.12+ is required for the current production Electron toolchain.
npm install
npm run app
```

Open the local preview and complete the first-run production setup. Atlas does not expose bundled test credentials in production mode.

For development-only sample data, explicitly run:

```bash
ATLAS_ALLOW_DEMO_DATA=true npm run reset:data
```

## What is included

- One Node.js application entrypoint: `app.tsx`. It serves the TSX React UI, API, local assets, exports, and data from one process.
- Internal API routes and the embedded schema-versioned document store live inside the same Node application at `data/atlas-store.json`.
- Local fonts only: `public/fonts/AtlasSans-Regular.ttf`, `AtlasSans-Bold.ttf`, and `AtlasDisplay-Bold.ttf`.
- No Google Fonts, CDN stylesheets, or remote UI assets.
- PWA manifest, icon, and service worker with local shell caching.
- Drag-and-drop task workflow board with API persistence.
- Advanced query builder on projects, tasks, people, activity, and alerts.
- Daily, weekly, monthly, quarterly, and yearly reports.
- Export and print customization: selected columns, title, CSV, Excel, JSON, PDF, orientation, margins, and print templates.
- Settings for theme, accent, density, sidebar mode, default landing page, default task view, page size, and demo data removal.
- Role-based access control with Administrator, Manager, Developer, and Viewer permissions enforced in both UI and Node routes.
- Access control interface for creating, editing, disabling, exporting, and deleting user accounts.
- Production first-run setup with no sample users or default credentials unless explicitly enabled through `ATLAS_ALLOW_DEMO_DATA=true`.
- Salted password hashing for local accounts.
- Database metadata, schema normalization, integrity checks, atomic persistence, backup support, and schema-versioned configuration branches for workspace/interface/localization/modules/workflows/custom fields/permissions/reports/integrations/security/audit.
- Current Electron production toolchain pinned to the actively patched release line with zero npm audit findings at validation time.

## Useful scripts

```bash
npm run init:production # clear to production first-run setup
npm run build           # production web + server build
npm run start           # run the built production application
npm run preview         # build, then run production locally
npm run reset:data      # development only: restore seeded local demo data
npm run backup:data     # create a timestamped embedded-store backup
```

## Production desktop deployment

See [`PRODUCTION.md`](PRODUCTION.md) for desktop packaging, production build, health checks, and detailed user activity reporting.


## Documentation

Complete production documentation is maintained in [`docs/`](docs/README.md):

- Complete manual: [`docs/ATLAS_WORKSPACE_MANUAL.md`](docs/ATLAS_WORKSPACE_MANUAL.md)
- Design standards: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- Database architecture: [`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md)
- API reference: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
- Developer guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Build/deployment: [`docs/BUILD_AND_DEPLOYMENT.md`](docs/BUILD_AND_DEPLOYMENT.md)
- Operations runbook: [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md)
- Functionality reference: [`docs/FUNCTIONALITY_REFERENCE.md`](docs/FUNCTIONALITY_REFERENCE.md)
- Configuration/i18n/extensibility: [`docs/CONFIGURATION_I18N_EXTENSIBILITY.md`](docs/CONFIGURATION_I18N_EXTENSIBILITY.md)
- Final acceptance report: [`docs/FINAL_ACCEPTANCE_REPORT.md`](docs/FINAL_ACCEPTANCE_REPORT.md)

- `docs/CONFIGURATION_SETUP_ADVANCEMENTS.md` — latest advanced setup and full configuration console improvements.
- `docs/FIELD_ENTRY_CONFIGURATION_FIX.md` — field entry stability fix and modern configuration field layout update.
- `docs/FULL_INTERFACE_I18N_UPDATE.md` — full interface translation coverage and setup-first language selection.
- `docs/TRANSLATION_SYSTEM_ARCHITECTURE.md` — advanced translation runtime, API endpoints, and integration model for custom interfaces.
