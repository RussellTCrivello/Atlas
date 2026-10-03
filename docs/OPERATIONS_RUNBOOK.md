# Operations runbook

For operators. Installation, environment variables, reverse-proxy and backup mechanics are in [`PRODUCTION.md`](../PRODUCTION.md);
this is the day-to-day and incident guide. Commands below use `npm run …`; on a server without the source tree use
`node dist-desktop/app.mjs --<flag>` (same behaviour).

## Routine

| When                                                                         | Do                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily                                                                        | Check `GET /api/health` (alert on non-200). Make sure `backups/` is being copied off the machine.                                                                                       |
| Weekly                                                                       | Settings → System: integrity **ok**, audit chain **verified**, backup list fresh, free disk space. Skim Settings → System → "Show audit trail" for failed sign-ins and denied requests. |
| After any settings change to security (password length, sessions, retention) | The change is in the audit trail with before/after values; confirm it was intended.                                                                                                     |
| Monthly                                                                      | Review accounts (disable people who left), roles, and who can see per-person activity (Settings → Reports). Test `restore:data` on a copy.                                              |
| Before and after upgrades                                                    | `PRODUCTION.md` §7.                                                                                                                                                                     |

## People and accounts

- **Create**: Settings → Access → Add user. The password you set is temporary: the person must choose their own at first
  sign-in and cannot use the application before then.
- **Reset a password**: edit the user and enter a new password (their sessions end immediately and they must change it).
- **Disable / delete**: disabling ends sessions at once. The last active administrator cannot be demoted, disabled or deleted.
  Deleting an account keeps the person profile and their history.
- **Roles**: Settings → Access → roles. Nobody can grant a role that outranks their own.
- **A person left**: disable the account; delete the person profile only if you accept that their tasks become unassigned.
  Ledger rows keep their name as "Former member".

## Incidents

### Nobody can sign in as an administrator (lost password, disabled account, locked out)

Stop the server (or use another machine with access to the data directory) and run:

```bash
npm run admin:reset-password -- --email admin@example.com --activate --role Administrator
```

It prints a temporary password once, ends that account's sessions, makes the account active, restores the Administrator role if
asked, and forces a password change at next sign-in. A backup is taken first and the action is audited.

### "Too many attempts. Try again in N seconds."

Sign-in is throttled per address (30 attempts per 10 minutes) and per account (5 failures, then 15 s doubling to 15 min). It
clears itself; restarting the server also clears it. If everybody is blocked at once behind a proxy, `ATLAS_TRUST_PROXY` is not
set and all clients look like the proxy.

### The server refuses to start: "Atlas cannot start: … is not valid JSON" (or "newer than this build")

The data file is damaged (or was written by a newer Atlas). **It has not been modified.** Follow `PRODUCTION.md` §6: stop any
other process, `npm run restore:data -- latest`, start. Keep the damaged file for diagnosis (it is stored as a `pre-restore`
backup). Never delete `atlas-store.json` to "reset": with backups present Atlas will refuse to start empty on purpose.
A "newer than this build" error means you started an older version against newer data: start the newer version, or restore a
pre-migration backup with the old one.

### "Another Atlas process … is already using …"

Something else owns the data directory: a second server, or a desktop app using the same folder. Stop it. If you are certain
nothing is running (the process crashed and the machine did not reboot, so the PID check could not tell), delete
`<data dir>/atlas.lock`. A lock left by a dead process on the same machine is removed automatically.

### Saves fail with "could not be saved to disk" / `/api/health` returns 503

The write failed (disk full, permissions, read-only filesystem). The change was rolled back and nothing is half-written. Fix the
cause (free space, `chown`); the next successful write turns health green again. No restart is needed.

### The setup page appears on a workspace that should exist

It cannot appear for a configured workspace. If it does, the store file was replaced by an empty one (wrong data directory, or
someone ran `init:production`). Do **not** complete setup. Stop the server, check `ATLAS_DATA_DIR`, and restore a backup
(`list:backups`, `restore:data`). Setup requires the one-time token, which is printed only in the server console.

### The workspace is slow

Check size first: Settings → System counts, or `ls -lh <data dir>/atlas-store.json`. Around 10,000 tasks (≈ 10 MB) the load and
every save become noticeable (`PRODUCTION.md` §8). Prune what you can (delete closed projects after export; the audit trail
prunes itself), or plan the move to a database (`DECISIONS_AND_OPEN_QUESTIONS.md` D11).

### A user sees too little (or too much)

Reports and the people directory are scoped by role: Viewers/Developers see their own activity unless **Settings → Reports →
Who can see per-person activity** is "Everyone". The account list is visible only with `manageUsers`; security and role settings
only with `manageSettings`. Check the role's permissions in Settings → Access.

### Integrity warnings in Settings → System

Warnings (missing references) do not stop the application; errors (duplicate ids/emails, plain-text passwords) need attention.
`npm run check:data` prints the same list. Fix through the UI where possible; otherwise stop the server, back up, edit the file
carefully, and run `check:data` again.

### Moving the data to another machine or directory

Stop the server, copy the whole data directory (store, `sessions.json`, `backups/`), set `ATLAS_DATA_DIR` on the new machine,
start. Delete `atlas.lock` in the copy if it came along while the old process was running. Same-version only.

### The audit trail says "Tamper check FAILED"

An entry was edited, removed or reordered, or the file was damaged. Compare with the newest backup (`list:backups`). The check
is evidence of damage, not proof of an attack; an attacker with file access could also have recomputed the chain, so treat it as
a prompt to investigate.

### Desktop app

- **Window does not open / "Atlas failed to start"**: the message says why; for an unreadable data file the app offers to
  restore the newest backup or open the data folder. Data lives in the OS user-data folder under `data/` (Windows
  `%APPDATA%\Atlas Workspace\data`, macOS `~/Library/Application Support/Atlas Workspace/data`, Linux
  `~/.config/Atlas Workspace/data`).
- **Launching twice** focuses the existing window (one instance only).
- **Developer tools** are off in packaged builds (`ATLAS_DEVTOOLS=1` turns them on for support).

## Privacy and records

Atlas stores names, e-mail addresses, job titles, task assignments and a ledger of who did what and when. Before enabling
per-person activity for everyone, decide the purpose with the people concerned (see D2 in `DECISIONS_AND_OPEN_QUESTIONS.md`).
There is **no built-in export or erasure tool for one person's data**; until there is, handle such requests by editing a
backed-up copy deliberately and documenting it.

## Maintenance checklist

- [ ] Health check alert configured; backups copied off-box; one restore rehearsed.
- [ ] Reverse proxy sets `X-Forwarded-*`; Atlas has `ATLAS_TRUST_PROXY`, `ATLAS_ALLOWED_HOSTS`, `ATLAS_COOKIE_SECURE`.
- [ ] Node and dependencies current (Dependabot PRs reviewed); `npm audit --omit=dev` clean.
- [ ] Accounts and roles reviewed; no shared accounts.
- [ ] Disk space and store size reviewed against the 10,000-task guideline.
