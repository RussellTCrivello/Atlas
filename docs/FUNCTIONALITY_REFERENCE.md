# Atlas Workspace Functionality Reference

> **Partly out of date.** Written before the remediation release (store schema 3.1.0). Where it disagrees with
> [`PRODUCTION.md`](../PRODUCTION.md), [`SECURITY.md`](SECURITY.md), [`API_REFERENCE.md`](API_REFERENCE.md) or
> [`DATABASE_ARCHITECTURE.md`](DATABASE_ARCHITECTURE.md), those win. Known differences: effort **minutes no longer exist** (the old
> figures were fixed constants, not measurements); setup requires a one-time token; the interface localiser never rewrites
> user-entered data and each person can choose a language and theme for themselves; settings labelled "Not applied yet" are stored
> but do nothing; workspace data is no longer sent in full to every role.

## Product overview

Atlas Workspace is a local-first engineering/operations workspace for tracking projects, tasks, people, activity, alerts, and decision-ready reports from a single Node.js/TSX application.

Core capabilities:

- Production first-run setup.
- Secure login.
- Role-based permissions.
- Dashboard overview.
- Project management.
- Drag-and-drop task workflow.
- People/team management.
- Daily activity logging.
- Alerts and blocker management.
- General reports across daily, weekly, monthly, quarterly, yearly periods.
- User activity reports across daily, weekly, monthly periods.
- CSV, Excel, JSON, PDF, and print exports with customization.
- Settings, access control, and system integrity.
- Desktop packaging through Electron.

## Setup

First-run setup creates the initial administrator and workspace identity. Production mode does not show demo credentials.

Fields:

- Workspace name
- Unit/department
- Administrator name
- Administrator email
- Administrator password
- Include demo data, only when `ATLAS_ALLOW_DEMO_DATA=true`

## Login

Users sign in with administrator-created credentials. The login screen communicates:

- Production access.
- No bundled sample credentials.
- Local assets.
- Hashed passwords.
- Role-based permissions.

## Overview

The overview provides a command-center summary:

- Active projects.
- Open tasks.
- Attention/risk count.
- Completed tasks.
- Daily pulse sections.
- Upcoming milestones.
- My tasks.

Use it for daily standup and quick triage.

## Projects

Project records include:

- Name
- Code
- Description
- Team
- Owner
- Color
- Status
- Deadline
- Progress derived from tasks
- Members derived from ownership and assignments
- Milestones

Managers and administrators can create, edit, and delete projects.

## My Work / Tasks

Tasks include:

- Title
- Project
- Assignee
- Priority
- Due date
- Status
- Type
- Blocked state

Workflow states:

1. To do
2. In progress
3. Review
4. Testing
5. Done

Drag-and-drop status changes persist through the API and create work-log events when status changes.

## People

People records represent contributors, whether or not they can sign in.

Fields:

- Name
- Email
- Job title
- Team
- Focus
- Capacity
- Status
- Color

People records drive ownership, assignee labels, capacity displays, and report attribution.

## Activity log

Activity entries capture daily updates:

- Yesterday
- Today
- Blocked
- Upcoming
- Person
- Status

Activity entries create reportable work-log evidence.

## Alerts

Alerts track risks, blockers, overdue items, and information.

Fields:

- Title
- Body
- Type
- Tone
- Project
- Task
- Resolved state

Alerts can be resolved by users with write or alert-management permissions.

## Reports

### General reports

Periods:

- Daily
- Weekly
- Monthly
- Quarterly
- Yearly

Metrics include:

- Completed tasks
- Planned tasks
- Delivery rate
- Remaining tasks
- Active projects
- Completed projects
- Blocked tasks
- Overdue tasks
- Alerts
- Project rows

### User activity intelligence

Periods:

- Daily
- Weekly
- Monthly

Scopes:

- All users aggregate
- Individual person/user

Report includes:

- Totals
- Series
- Per-user summaries
- Project contribution summaries
- Evidence rows

Evidence rows include exactly which tasks were performed, project context, user/person, action, status movement, source, and summary.

## Export and print

Export menus support:

- CSV
- Excel-compatible `.xlsx`
- JSON
- PDF
- Print
- Custom title
- Column selection
- Orientation
- Margins
- Template selection

Templates:

- Standard report
- Compact table
- Executive summary

## Settings

Settings surfaces include:

- Local assets and app shell.
- Access control.
- Workspace identity.
- Interface preferences.
- Export and print defaults.
- Navigation access.
- System store integrity.

## Access control

Administrators can:

- Create users.
- Edit users.
- Change roles.
- Link people profiles.
- Disable users.
- Delete users where safe.
- Export access-control records.

Safety constraints:

- Cannot delete self.
- Cannot delete the last active administrator.
- Backend enforces all permissions.

## Query/search

The app includes advanced query/search surfaces for operational records. Search is available from the topbar and supports cross-surface navigation.

## Desktop mode

When launched with Electron:

- Atlas runs as the same production Node application.
- The native shell loads the local server.
- Desktop metadata is exposed through a safe preload bridge.
- Data is stored in Electron userData.
