# Atlas Workspace Design System and Interface Standards

> **Partly out of date.** Written before the remediation release (store schema 3.1.0). Where it disagrees with
> [`PRODUCTION.md`](../PRODUCTION.md), [`SECURITY.md`](SECURITY.md), [`API_REFERENCE.md`](API_REFERENCE.md) or
> [`DATABASE_ARCHITECTURE.md`](DATABASE_ARCHITECTURE.md), those win. Known differences: effort **minutes no longer exist** (the old
> figures were fixed constants, not measurements); setup requires a one-time token; the interface localiser never rewrites
> user-entered data and each person can choose a language and theme for themselves; settings labelled "Not applied yet" are stored
> but do nothing; workspace data is no longer sent in full to every role.

## Purpose

Atlas Workspace must feel like a polished production operations product, not a prototype. Every surface should help users answer four questions quickly:

1. What needs attention?
2. Who owns it?
3. Which project or task does it affect?
4. What can I do next?

The design system applies to every interface: setup, login, dashboard, projects, tasks, people, activity, reports, alerts, settings, access control, export panels, print views, and desktop/PWA shells.

## Non-negotiable design principles

### 1. Self-contained professionalism

- Fonts, icons, manifest, service worker, styles, UI code, and report assets must be served locally.
- No Google Fonts, CDN stylesheets, remote UI libraries, remote image dependencies, or externally hosted design assets are permitted for core UI rendering.
- The interface shell and its assets load from the Atlas server with no external dependency. Working without the server is not supported: offline, the service worker shows a notice page (see D12 in `DECISIONS_AND_OPEN_QUESTIONS.md`).

### 2. Clarity before density

- Primary screens use a summary-first hierarchy: heading, explanatory subtitle, actions, key metrics, then detailed data.
- Tables and ledgers must provide filters, context labels, owners, status, and export paths.
- Empty states must explain what is missing and what action creates the first useful record.

### 3. Role-aware interfaces

- Controls that a user cannot use should be hidden or clearly shown as read-only.
- Backend authorization is authoritative. UI permissions improve usability but do not replace server enforcement.
- Permission notices must explain which role can complete restricted actions.

### 4. Data confidence

- Reports must show time period, selected user/project scope, totals, and detailed evidence rows.
- Activity reports must preserve project, task, user, action, status movement, and source (never an invented effort figure).
- System information must expose data-store integrity and schema version to administrators.

### 5. Fast, low-friction workflows

- Common creation paths are available from the top action and quick action rail.
- The task board supports drag-and-drop status changes with persisted API updates.
- Search must cover major records and navigate users directly to the right surface.

### 6. Accessible interaction

- All buttons, inputs, selects, and textareas need visible focus states.
- Color cannot be the only meaning carrier; status text and labels accompany semantic colors.
- Target sizes should remain comfortable for desktop and tablet pointer use.
- Motion should be subtle and can be disabled through settings.

### 7. Print and export quality

- Report outputs are first-class product surfaces.
- Exportable data must support selected columns, custom title, CSV, Excel, JSON, PDF, orientation, margins, and print templates.
- Printed reports should read clearly without relying on interactive affordances.

## Design tokens

The canonical tokens live in `src/styles.css`. They are intentionally CSS custom properties so the single app can render consistently in browser, PWA, and Electron contexts.

### Typography

- Primary font: `Atlas Sans`, loaded from `public/fonts/AtlasSans-Regular.ttf` and `public/fonts/AtlasSans-Bold.ttf`.
- Display font: `Atlas Display`, loaded from `public/fonts/AtlasSans-Bold.ttf` (the same bold face).
- System fallback: `system-ui, sans-serif`.
- Headings use Atlas Display with tight tracking.
- Body, controls, labels, navigation, and table content use Atlas Sans.

### Color tokens

| Token                                                         | Use                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `--ink`                                                       | Primary text and highest-emphasis labels.              |
| `--ink-soft`                                                  | Secondary text, descriptions, and supporting metadata. |
| `--muted`                                                     | Low-emphasis helper copy and placeholders.             |
| `--line`                                                      | Default border and separators.                         |
| `--line-strong`                                               | Stronger form/table borders.                           |
| `--paper`                                                     | Cards, panels, sidebar, and topbar.                    |
| `--canvas`                                                    | Main application background.                           |
| `--purple` / `--purple-deep` / `--purple-pale`                | Primary brand action and selected state.               |
| `--blue`, `--green`, `--orange`, `--red`, `--yellow` families | Status, priority, health, alerts, and semantic states. |

### Elevation

- `--shadow` is the default production card shadow.
- Elevation must be used sparingly; borders and layout should carry most hierarchy.
- Modals and command overlays may use stronger shadows only when they sit above a dimmed or separated layer.

### Shape and spacing

- Primary buttons and controls: compact rounded rectangle, usually 7–8px radius.
- Cards and panels: 11–14px radius depending on density.
- Sidebar items: 8px radius and clear active indicator.
- Spacing follows a 4px-derived rhythm: 4, 7/8, 10/12, 14/16, 20/24, 30/42.

## Interface anatomy standards

### Shell

- Persistent sidebar for workspace navigation.
- Topbar with page title, subtitle, search, alerts, theme toggle, and contextual create action.
- Content area constrained to a readable maximum width.
- Desktop mode bar communicates local assets, unified API, board interaction, export/print capability.

### Setup screen

- Must communicate production first-run setup.
- Must not expose sample credentials unless `ATLAS_ALLOW_DEMO_DATA=true` is explicitly enabled.
- Requires administrator name, email, and a password of at least eight characters.
- Workspace name and unit are real organization defaults, not demo names.

### Login screen

- Production login never pre-fills demo credentials.
- Demo accounts appear only in development demo mode.
- Login copy should reinforce production defaults, local assets, hashed passwords, and role enforcement.

### Dashboard / overview

- Use metric cards for active projects, open tasks, attention items, and completed tasks.
- Use daily pulse sections for yesterday, today, blockers, and upcoming milestones.
- Prioritize immediately actionable information.

### Projects

- Project cards and lists must include owner, team, status/health, progress, deadline, and members.
- Project forms must capture code, description, team, owner, color, status, and deadline.

### Tasks

- Board states are canonical: `To do`, `In progress`, `Review`, `Testing`, `Done`.
- Drag-and-drop must persist through `/api/tasks/:id/status`.
- Task cards must include project, assignee, priority, due date, status, type, and blocked state.

### People

- People views must connect profiles to teams, capacity, status, and focus.
- Users and people are related but distinct: people are work profiles; users are login/access records.

### Activity

- Activity records should capture yesterday, today, blocked, upcoming, status, person, date, and time.
- Blockers should be visually distinct and reportable.

### Reports

- General reports support daily, weekly, monthly, quarterly, and yearly views.
- User activity intelligence supports daily, weekly, and monthly user and all-user aggregate reports.
- Reports must include both totals and evidence rows.

### Settings and access control

- Settings must include local assets/system store details, workspace identity, interface preferences, export defaults, navigation access, user access control, and database integrity.
- Access control must show role, team, status, and action controls.

## Component standards

### Buttons

- Primary action: `.primary-button` with brand color and small lift on hover.
- Secondary action: `.secondary-button` with border and neutral background.
- Text action: `.text-button` for low-emphasis links/actions.
- Destructive actions must use danger styling and should be confirmed when the result is destructive.

### Forms

- Labels are always visible.
- Required fields should use browser validation where appropriate and server validation always.
- Errors use `.form-error` or `.global-error`, include iconography, and describe the fix.
- Form layout can use two-column `.form-row` only when each field remains readable.

### Tables and ledgers

- Tables must show headers, clear numeric alignment when relevant, and stable row spacing.
- Export menus should be near report/table content.
- Large table contexts should offer filters or query builder controls.

### Cards and panels

- Cards should include a clear title, optional explanatory text, and a focused set of details.
- Avoid mixing unrelated record types in the same card unless it is a dashboard summary.

### Status indicators

- Use semantic text and color together.
- Supported tones: on-track/green, at-risk/orange, blocked/red, neutral/blue or muted.

### Modals and command palette

- Modals should open with focused first field.
- Command search must allow cross-record navigation and quick discovery.
- Escape/click-close behavior should not discard unsaved data silently in future enhancements.

## Motion standards

- Motion is subtle: small translate and fade, no large layout shifts.
- Motion must not be required to understand state.
- `settings.showAnimations` controls animation preference for production users.

## Accessibility checklist

Every new or changed interface must satisfy this checklist:

- [ ] Controls have visible focus states.
- [ ] Inputs have labels.
- [ ] Interactive icons have accessible labels when no visible text is present.
- [ ] Text contrast is sufficient against the background.
- [ ] Status is expressed with text and not only color.
- [ ] Keyboard users can reach major controls.
- [ ] Empty, loading, and error states are understandable.
- [ ] UI does not require external network assets.

## Interface review checklist

Use this before considering a feature production-ready:

- [ ] Page has a clear title and explanation.
- [ ] Primary action is obvious and role-aware.
- [ ] Data has owner/project/task context where applicable.
- [ ] Lists/tables can be filtered, searched, or exported when operationally relevant.
- [ ] Server enforces all permissions used by the UI.
- [ ] All copy avoids demo/test assumptions in production mode.
- [ ] Local fonts/assets render without network access.
- [ ] Print/export output remains legible and complete.
- [ ] Mobile/tablet layouts do not hide essential workflows.
