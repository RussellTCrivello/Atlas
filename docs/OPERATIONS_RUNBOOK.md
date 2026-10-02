# Atlas Workspace Operations Runbook

## First-run production setup

1. Install dependencies and build if running production:

   ```bash
   npm install
   npm run init:production
   npm run build
   npm run start
   ```

2. Open Atlas.
3. Complete the setup wizard:
   - Workspace name
   - Unit/department
   - Administrator name
   - Administrator email
   - Administrator password
4. Sign in with the created administrator account.
5. Create teams, people, projects, tasks, and additional user accounts.

Production setup creates no demo accounts and no sample data.

## Daily operation

Typical operational loop:

1. Review Overview for active projects, open work, attention items, and daily pulse.
2. Use Projects to inspect project health, owner, team, deadline, milestones, and progress.
3. Use My Work to drag tasks through workflow states.
4. Use Activity to record daily updates and blockers.
5. Use Alerts to resolve risk/overdue/blocker items.
6. Use Reports to export daily/weekly/monthly/quarterly/yearly delivery reports and activity reports.
7. Use Settings for access control, workspace configuration, and database integrity checks.

## Administrator responsibilities

Administrators should periodically:

- Review Settings → System store integrity.
- Export or back up data.
- Audit active users and roles.
- Disable accounts that no longer need access.
- Confirm there is at least one active administrator.
- Validate reports before leadership distribution.
- Keep Node/Electron dependencies updated through normal release maintenance.

## User management

User accounts are managed in Settings → Access control.

Available roles:

- Administrator
- Manager
- Developer
- Viewer

Rules:

- Do not share administrator accounts.
- Disable inactive users instead of deleting if record continuity matters.
- Do not delete the last active administrator.
- Link user accounts to person profiles for activity/report attribution.

## Backup

Manual backup:

```bash
npm run backup:data
```

Backups are written to:

```txt
data/backups/
```

Electron backups are under the app userData data directory.

Recommended cadence:

- Before upgrades: mandatory.
- Before bulk user/project changes: mandatory.
- Normal small team use: daily or weekly depending on data sensitivity.
- High-change operational periods: enable `ATLAS_BACKUP_ON_WRITE=true` temporarily.

## Restore

1. Stop Atlas.
2. Copy the backup over the active store file.
3. Start Atlas.
4. Sign in as administrator.
5. Check Settings → System store.

Example:

```bash
cp data/backups/atlas-store-<timestamp>-manual.json data/atlas-store.json
npm run start
```

## Health checks

```bash
curl http://127.0.0.1:5173/api/health
```

Expected:

```json
{
  "ok": true,
  "name": "Atlas Workspace",
  "version": "1.0.0",
  "desktopReady": true
}
```

## Integrity checks

Use an administrator session to call:

```txt
GET /api/system
```

or inspect Settings → System store.

Integrity values:

- `ok`: no errors or warnings.
- `warning`: non-critical relationship or schema concerns.
- `attention`: critical issue requiring administrator action.

## Security posture

Atlas production defaults:

- No default/demo credentials.
- First-run administrator setup.
- HTTP-only session cookies.
- Optional secure cookies with `ATLAS_COOKIE_SECURE=true`.
- Salted `scrypt` password hashes.
- Role-based backend authorization.
- Local-only core UI assets.
- Production host defaults to `127.0.0.1`.

## Common troubleshooting

### Setup page keeps appearing

`configured` is false. Complete first-run setup or restore a configured data store.

Check:

```bash
curl http://127.0.0.1:5173/api/setup/status
```

### User cannot mutate records

Check role permissions. UI controls may be hidden/read-only, and backend will return `403` if the permission is missing.

### Activity report is missing rows

Activity reports use `workLogs`. Create/update/complete tasks or log activity entries to generate report evidence.

### Production app cannot be reached remotely

Production defaults to `127.0.0.1`. To expose intentionally:

```bash
ATLAS_HOST=0.0.0.0 npm run start
```

Only do this behind a trusted reverse proxy/firewall.

### Data integrity warning appears

1. Open Settings → System store.
2. Review warnings/errors.
3. Check for deleted teams/people/projects still referenced by records.
4. Restore from backup if needed.
5. If adding a new feature caused it, update `normalizeStore()` and `validateStoreState()`.

### Electron package opens but data is empty

Desktop uses Electron `userData/data`, not the repository `data/` directory. Complete first-run setup in the desktop app or copy a data store into the Electron userData data path.

## Maintenance checklist

Weekly/monthly for active teams:

- [ ] Create data backup.
- [ ] Confirm `/api/health`.
- [ ] Confirm Settings → System store integrity.
- [ ] Review user roles and disabled accounts.
- [ ] Export key reports.
- [ ] Validate no demo data exists in production unless intentionally enabled.

Before upgrades:

- [ ] Create backup.
- [ ] Run `npm audit --omit=dev`.
- [ ] Run `npm audit`.
- [ ] Run `npm run build`.
- [ ] Run production smoke test with temporary data.
- [ ] Package desktop directory.

