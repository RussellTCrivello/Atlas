# Atlas Workspace: production guide

This guide is for the person who installs, runs and maintains an Atlas server. It describes what the code does today. Where
something is **not** verified or **not** provided, it says so.

## 1. Supported deployment models

| Model                                  | Status              | Notes                                                                                                                 |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| One user, one machine (loopback)       | Supported           | `npm start`; nothing else can connect.                                                                                |
| Desktop app (Electron)                 | Supported, see §9   | Packaging not verified end to end in the release environment.                                                         |
| A team on a LAN or VPN                 | Supported with care | Put a TLS-terminating reverse proxy in front (§4). Do not expose the Node port directly.                              |
| Public internet                        | **Not recommended** | No SSO/MFA, no rate limiting beyond sign-in, one process. If you must, use a VPN or an authenticating proxy in front. |
| Several Atlas processes, HA, scale-out | **Not supported**   | One process owns the data directory (lock file). The store is a single JSON file.                                     |

## 2. Build and run

```bash
node -v            # 22.x (see .nvmrc); `engine-strict` rejects older versions
npm ci             # not `npm install`: install exactly what package-lock.json pins
npm run build
npm start
```

`npm run build` produces

- `dist/`: the web application (content-hashed assets, service worker, icons, offline page);
- `dist-desktop/app.mjs`: the server, **with its dependencies bundled in** (about 2.3 MB). It needs only Node 22, the `dist/`
  folder and (optionally) `package.json` for the version string. Neither file is tracked in git.

To deploy without the source tree, copy `dist/`, `dist-desktop/app.mjs` and `package.json`, then run
`NODE_ENV=production node dist-desktop/app.mjs` (point `ATLAS_STATIC_DIR` at `dist/` if it is not next to the bundle's
parent folder). `npm start` is the same thing with a friendlier error when the build is missing and works on Windows.

At start-up the server prints the URL, any configuration warnings and, **only while no workspace exists**, the one-time setup
token. If the data file is unreadable it refuses to start and prints how to recover (§6).

## 3. Environment variables

All configuration is validated at start-up; an invalid value is reported (and ignored) rather than silently misread.

| Variable                 | Default                                                | Meaning                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | (development)                                          | `production` enables the strict CSP, serves `dist/`, and refuses demo data.                                                                                |
| `PORT`                   | `5173`                                                 | TCP port. `0` picks a free port.                                                                                                                           |
| `ATLAS_HOST` / `HOST`    | `127.0.0.1`                                            | Bind address. Anything else exposes the sign-in page to that network.                                                                                      |
| `ATLAS_DATA_DIR`         | `<project root>/data`                                  | Where `atlas-store.json`, `sessions.json`, `backups/` and `atlas.lock` live. **Independent of the working directory.** Created with mode 0700.             |
| `ATLAS_STATIC_DIR`       | `<project root>/dist`                                  | Built web app.                                                                                                                                             |
| `ATLAS_ROOT`             | found from the code location                           | Project root override (packaging).                                                                                                                         |
| `ATLAS_SETUP_TOKEN`      | random per start                                       | Token required by first-run setup (min. 8 characters). Printed only while unconfigured.                                                                    |
| `ATLAS_COOKIE_SECURE`    | `auto`                                                 | `auto` marks the session cookie `Secure` when the request is HTTPS (needs `ATLAS_TRUST_PROXY` behind a proxy); `true`/`false` force it.                    |
| `ATLAS_TRUST_PROXY`      | off                                                    | Express "trust proxy" (`1`, `loopback`, a CIDR list, or `true`). Needed so client IPs (throttling, audit) and HTTPS detection come from the proxy headers. |
| `ATLAS_ALLOWED_HOSTS`    | loopback names (or any, if bound to a network address) | Comma-separated `Host` allow-list; other hosts get 403 (defends against DNS rebinding). **Set this behind a proxy.**                                       |
| `ATLAS_BACKUP_RETENTION` | `25`                                                   | Whole number 3-100. Applied separately to routine write snapshots and to all other backups. Invalid values are ignored with a warning.                     |
| `ATLAS_BACKUP_ON_WRITE`  | `false`                                                | `true` snapshots the store before _every_ write (more disk I/O, finer recovery points).                                                                    |
| `ATLAS_TIMEZONE`         | the host's time zone                                   | Default time zone for _new_ workspaces. Existing workspaces keep their own setting.                                                                        |
| `ATLAS_ALLOW_DEMO_DATA`  | `false`                                                | Development only. **Ignored (with a warning) when `NODE_ENV=production`.**                                                                                 |
| `ATLAS_DEVTOOLS`         | off                                                    | `1` enables developer tools in a packaged desktop build.                                                                                                   |

## 4. Reverse proxy and HTTPS

Run Atlas on loopback and terminate TLS in front of it. nginx example:

```nginx
server {
  listen 443 ssl;
  server_name atlas.example.com;
  ssl_certificate     /etc/ssl/atlas.crt;
  ssl_certificate_key /etc/ssl/atlas.key;
  client_max_body_size 2m;               # Atlas rejects bodies over 1 MB anyway

  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

and start Atlas with

```bash
NODE_ENV=production ATLAS_TRUST_PROXY=1 ATLAS_ALLOWED_HOSTS=atlas.example.com ATLAS_COOKIE_SECURE=true node dist-desktop/app.mjs
```

With `ATLAS_TRUST_PROXY` set, Atlas sends `Strict-Transport-Security` on HTTPS requests and uses the forwarded client address
for sign-in throttling and the audit trail. Without it every client looks like the proxy and one attacker could lock everybody
out; do not skip it. The proxy must overwrite (not append to) `X-Forwarded-*` headers it receives from clients.

### systemd unit (Linux)

```ini
[Unit]
Description=Atlas Workspace
After=network.target

[Service]
User=atlas
WorkingDirectory=/opt/atlas
Environment=NODE_ENV=production ATLAS_DATA_DIR=/var/lib/atlas ATLAS_TRUST_PROXY=1 ATLAS_ALLOWED_HOSTS=atlas.example.com ATLAS_COOKIE_SECURE=true
EnvironmentFile=-/etc/atlas.env          # optional: ATLAS_SETUP_TOKEN=...
ExecStart=/usr/bin/node /opt/atlas/dist-desktop/app.mjs
Restart=on-failure
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/atlas
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

`SIGTERM` is handled: in-flight requests finish, queued audit events and sessions are flushed and the lock is released.

## 5. First run

1. Start the server and copy the setup token from the console (or the journal), or set `ATLAS_SETUP_TOKEN` yourself.
2. Open the site, complete the wizard, paste the token on the last step.
3. The administrator you create is signed in. Create other accounts under **Settings, Access**; people whose password you set
   must choose their own at first sign-in.

Once a workspace exists, `POST /api/setup` answers `409` forever. To start over deliberately: stop the server and run
`npm run init:production -- --yes` (a backup is taken first).

## 6. Backups, recovery and integrity

What protects the data:

- **Durable writes**: every change is written to a temp file, `fsync`ed, renamed over the store and the directory `fsync`ed. A
  crash leaves either the old or the new complete file. If a write fails (disk full, permissions) the change is rolled back in
  memory, the client gets a clear `503`, and `/api/health` turns red until the next successful write.
- **One writer**: `atlas.lock` stops a second process (or a second desktop launch) from using the same directory. A lock left
  by a crashed process is detected and removed on the next start.
- **Backups** in `<data dir>/backups/`, named `atlas-store-<UTC timestamp>-<reason>.json`: one **daily** snapshot (taken at start-up or before
  the first write of the day, whichever comes first), **pre-migration**, **pre-restore**, **pre-delete-project**, **pre-settings-import**,
  **pre-remove-demo**, **pre-init-production** snapshots, **manual** ones (`npm run backup:data` or Settings, System) and, if
  enabled, per-write snapshots. Each backup is verified after copying. Retention is applied per kind, so routine write
  snapshots can never push out the snapshots taken before risky operations.
- **Fail closed**: an unparsable or newer-than-supported store stops the server with instructions. It is never renamed,
  replaced or "repaired" automatically, and a missing store next to existing backups does not silently start an empty
  (claimable) workspace.

Routine commands (all work from the built bundle: `node dist-desktop/app.mjs --backup-data`, `--list-backups`, `--check-data`,
`--restore latest`, `--reset-admin-password --email …`):

```bash
npm run backup:data                   # safe while the server is running
npm run list:backups
npm run check:data                    # validate the store (exit code 2 on integrity errors)
npm run restore:data -- latest        # server must be stopped; keeps the replaced file as a pre-restore backup
npm run restore:data -- atlas-store-20261002T081500123Z-manual.json
npm run admin:reset-password -- --email admin@example.com --activate --role Administrator
```

**Copy backups off the machine.** They live next to the data they protect. A nightly `rsync -a /var/lib/atlas/backups/ host:...`
is enough. Backups contain password hashes: protect them like the store itself (files are created `0600`).

Recovery from a damaged store:

1. `journalctl -u atlas` (or the console) shows `Atlas cannot start: …` and lists the newest backups. The file was not touched.
2. `npm run restore:data -- latest` restores the newest backup that parses and validates (a corrupt newest file is skipped).
3. Start the server. Data written after that backup was taken is lost; the damaged file is kept as `pre-restore`.

## 7. Upgrades and migrations

1. Stop Atlas, copy the data directory.
2. Deploy the new files, start Atlas.
3. If the store uses an older schema, Atlas takes a **pre-migration** backup of the untouched file and migrates in place.
   Check `GET /api/health` and Settings, System.

Schema `3.1.0` (this release) removes ledger rows and effort minutes that earlier versions _invented_ for tasks that had no
events, freezes task keys, derives ledger rows from recorded task/activity dates, resets role ranks to their canonical values
and drops frozen copies of the built-in translations. **Downgrading is not supported**: restore the pre-migration backup with
the older version instead.

## 8. Monitoring, capacity and limits

- `GET /api/health` returns `200 {ok:true,…}` or **`503`** when the store cannot be written. Use it for liveness checks.
- `GET /api/system` (administrator) reports integrity, audit-chain status, backup list, counts and storage health.
- Measured on a 2-core sandbox with realistic data (including the ledger), Node 22:

| Tasks  | Store file | Load workspace (`/api/bootstrap`) | Activity report | One write |
| ------ | ---------- | --------------------------------- | --------------- | --------- |
| 1,000  | 1.1 MB     | 0.06 s                            | 0.03 s          | 16 ms     |
| 10,000 | 10.7 MB    | 0.18 s                            | 0.21 s          | 78 ms     |
| 50,000 | 53.7 MB    | 1.0 s (21 MB uncompressed)        | 1.0 s           | 415 ms    |

The whole store is held in memory, rewritten on every change and sent to the browser at load. **About 10,000 tasks is the
comfortable ceiling.** Beyond it, expect slow saves and heavy page loads; the remedy is server-side pagination and/or a
database (see `docs/DECISIONS_AND_OPEN_QUESTIONS.md`).

- Sign-in hashing is asynchronous with at most two concurrent scrypt operations (~128 MiB each); budget ~300 MB of headroom.
- Audit entries older than `audit.retentionDays` (default 365, minimum 30) are pruned; work-ledger rows are kept forever
  unless `audit.workLogRetentionDays` is set.

## 9. Desktop app

```bash
npm run desktop          # build + run the Electron shell
npm run desktop:dir      # unpacked package in release/ (validation)
npm run desktop:pack     # installers: NSIS + portable (Windows), AppImage + deb (Linux), dmg (macOS)
```

The shell starts the same server inside Electron on `127.0.0.1` (a random port remembered between launches), stores data in
the OS user-data folder under `data/`, allows **one instance at a time**, runs the window sandboxed with context isolation,
confines navigation to the local server, sends only `http(s)` and `mailto` links to the operating system, denies all
permission requests, and has no developer tools in packaged builds. The setup token is passed to the first-run screen
automatically. If the data file is unreadable it offers to restore the newest backup, open the data folder or quit.

**Not verified or not provided** (the environment used for this release could not download the Electron binary, and the GUI
could not be launched):

- building an installer and launching the packaged app on each OS (the CI workflow builds an unpacked Linux package and checks
  its contents; launching needs a display and is a manual release check, below);
- code signing and notarisation (needed to avoid SmartScreen/Gatekeeper warnings), and automatic updates;
- the application identifier `ai.arena.atlasworkspace` is a placeholder; changing it after release breaks upgrade continuity.

Manual release check: install on a clean machine, launch (setup token pre-filled), create a workspace, quit, relaunch (data
and sign-in survive), launch a second copy (the first window is focused, no second server starts), kill the process and
relaunch (no recovery prompt, data intact), run `Edit` menu shortcuts (cut/copy/paste), open a link to an external site
(opens in the system browser).
