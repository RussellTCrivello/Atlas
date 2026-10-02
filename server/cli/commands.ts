// The command line: backups, restore, checks, password recovery and the two destructive resets. Each command is a thin
// wrapper over the same database and service code the server uses; none of them can bypass a rule the server enforces.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createContainer } from '../app/container'
import type { AtlasConfig } from '../config'
import {
  BACKUP_DIR,
  LEGACY_STORE_FILE,
  createBackup,
  listBackupsIn,
  restoreBackup,
  verifyDatabaseFile
} from '../db/backup'
import { readLegacyStoreFile, validateStoreState } from '../db/legacy-store'
import { openDatabase, openReadOnly, databasePath } from '../db/open'
import { demoSnapshot } from '../seed/demo'
import { emptySnapshot } from '../seed/empty'
import { normalizeEmail } from '../util'
import { runChecks } from '../db/check'

const HELP = `Atlas Workspace
Usage: node dist-desktop/app.mjs [command]   (or: npm run app / npm start)

  (no command)                    start the server
  --backup-data                   snapshot the database to backups/ (safe while the server runs)
  --list-backups                  list backups, newest first
  --restore <file|latest>         replace the database with a backup (stop the server first)
  --check-data                    verify the database and print a summary (read-only)
  --reset-admin-password --email <address> [--password <new>] [--activate] [--role <role>]
                                  set a new password (prints a random one if omitted) for locked-out accounts
  --init-production --yes         DESTRUCTIVE: replace the database with an empty workspace (a backup is taken first)
  --reset-data                    development only: load demo data (needs ATLAS_ALLOW_DEMO_DATA=true, refused in production)
`

const COMMAND_FLAGS = [
  '--backup-data',
  '--list-backups',
  '--restore',
  '--check-data',
  '--reset-admin-password',
  '--init-production',
  '--reset-data'
]

/** A command-line failure with a user-facing message. `main()` prints it and exits; tests can assert on it. */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1
  ) {
    super(message)
    this.name = 'CliError'
  }
}
function fail(message: string, code = 1): never {
  throw new CliError(message, code)
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const next = argv[index + 1]
  return next && !next.startsWith('--') ? next : ''
}
const has = (argv: string[], name: string) => argv.includes(name)

/** Run a command if `argv` names one. Returns false when there is none (the caller then starts the server). */
export async function runCommand(argv: string[], config: AtlasConfig): Promise<boolean> {
  const dataFile = databasePath(config)
  if (has(argv, '--help') || has(argv, '-h')) {
    console.log(HELP)
    return true
  }
  // The server prints configuration warnings in its start-up banner; commands print them here, so a mistyped
  // setting (for example ATLAS_BACKUP_RETENTION=abc, which falls back to the default) is never silent.
  if (COMMAND_FLAGS.some(name => has(argv, name))) config.warnings.forEach(warning => console.warn(`⚠ ${warning}`))

  if (has(argv, '--backup-data')) {
    const backup = createBackup(config, null, 'manual')
    console.log(backup ? `Created backup ${backup}` : `No store found at ${dataFile}`)
    return true
  }

  if (has(argv, '--list-backups')) {
    const backups = listBackupsIn(config.dataDir)
    if (!backups.length) console.log(`No backups in ${path.join(config.dataDir, BACKUP_DIR)}`)
    backups.forEach(backup =>
      console.log(
        `${backup.createdAt}  ${String(backup.size).padStart(10)} B  ${backup.reason.padEnd(18)} ${backup.format === 'json' ? '(old JSON) ' : ''}${backup.file}`
      )
    )
    return true
  }

  if (has(argv, '--restore')) {
    const which = flag(argv, '--restore')
    if (!which) fail('Usage: --restore <backup file name | path | latest>')
    let result
    try {
      result = restoreBackup(config, which!)
    } catch (error) {
      fail(`Restore failed: ${(error as Error).message}`)
    }
    console.log(`Restored ${result!.restored}`)
    if (result!.preRestore) console.log(`The previous database was saved as ${result!.preRestore}`)
    console.log(
      `Contents: ${Object.entries(result!.counts)
        .map(([key, value]) => `${value} ${key}`)
        .join(', ')}`
    )
    return true
  }

  if (has(argv, '--check-data')) {
    checkData(config, dataFile)
    return true
  }

  if (has(argv, '--reset-admin-password')) {
    const email = normalizeEmail(flag(argv, '--email'))
    if (!email) fail('Usage: --reset-admin-password --email <address> [--password <new>] [--activate] [--role <role>]')
    const opened = openForCommand(config)
    try {
      const container = createContainer(config, opened.db)
      if (!container.repos.users.byEmail(email)) fail(`No account with email ${email}`)
      const supplied = flag(argv, '--password')
      const password = supplied || crypto.randomBytes(12).toString('base64url')
      const role = flag(argv, '--role') || undefined
      if (role && !container.ctx.settings.permissions?.roles?.[role]) fail(`Unknown role ${role}`)
      container.backups.snapshot('pre-password-reset')
      const user = container.users.resetPasswordFromCommandLine(
        email,
        password,
        { activate: has(argv, '--activate'), role },
        {}
      )
      console.log(`Password for ${user.email} updated. They must choose a new one at next sign-in.`)
      if (!supplied) console.log(`Temporary password (shown once): ${password}`)
    } finally {
      opened.db.close()
      opened.release?.()
    }
    return true
  }

  if (has(argv, '--init-production')) {
    const opened = openForCommand(config)
    try {
      const container = createContainer(config, opened.db)
      if (container.auth.isConfigured() && !has(argv, '--yes'))
        fail(
          'This workspace is configured. --init-production would erase it (a backup is taken first). Re-run with --yes to confirm.'
        )
      container.backups.snapshot('pre-init-production')
      container.ctx.transaction(() => container.repos.snapshot.replaceAll(emptySnapshot(config)))
      console.log(
        `Initialised ${dataFile} for first-run setup. A backup of the previous database is in ${path.join(config.dataDir, BACKUP_DIR)}.`
      )
    } finally {
      opened.db.close()
      opened.release?.()
    }
    return true
  }

  if (has(argv, '--reset-data')) {
    if (config.isProduction) fail('Refusing to load demo data with NODE_ENV=production.')
    if (!config.allowDemoData)
      fail(
        'Demo data has well-known passwords. Re-run with ATLAS_ALLOW_DEMO_DATA=true to confirm: ATLAS_ALLOW_DEMO_DATA=true npm run reset:data'
      )
    const opened = openForCommand(config)
    try {
      const container = createContainer(config, opened.db)
      container.backups.snapshot('pre-reset-data')
      container.ctx.transaction(() => container.repos.snapshot.replaceAll(demoSnapshot(config)))
      console.log(`Reset ${dataFile} with development demo data`)
    } finally {
      opened.db.close()
      opened.release?.()
    }
    return true
  }
  return false
}

function openForCommand(config: AtlasConfig) {
  return openDatabase(config, { allowFresh: true })
}

/** `--check-data`: read-only. Verifies the database (or, before the first start of a SQL build, the old JSON store). */
function checkData(config: AtlasConfig, dataFile: string) {
  const legacyFile = path.join(config.dataDir, LEGACY_STORE_FILE)
  if (!fs.existsSync(dataFile)) {
    if (!fs.existsSync(legacyFile)) fail(`No store found at ${dataFile}`)
    let checked
    try {
      checked = readLegacyStoreFile(legacyFile, config)
    } catch (error) {
      fail(`Store check failed: ${(error as Error).message}`, 2)
    }
    const validation = validateStoreState(checked!.state)
    console.log(
      `Old JSON store ${legacyFile}: ${validation.integrity.toUpperCase()} (it will be moved into the SQL database on next start)`
    )
    validation.errors.forEach(message => console.log(`  ERROR   ${message}`))
    validation.warnings.slice(0, 20).forEach(message => console.log(`  WARNING ${message}`))
    if (validation.errors.length) fail('The store has integrity errors.', 2)
    return
  }
  const verdict = verifyDatabaseFile(dataFile)
  if (!verdict.ok) fail(`Store check failed: ${verdict.error}`, 2)
  const db = openReadOnly(config)!
  try {
    const result = runChecks(db)
    console.log(`Store ${dataFile}: ${result.integrity.toUpperCase()}`)
    console.log(
      `  schema ${result.schemaVersion}, SQLite ${result.sqliteVersion}, ${result.counts.users} users, ${result.counts.people} people, ${result.counts.projects} projects, ${result.counts.tasks} tasks, ${result.counts.work_logs} ledger rows, ${result.counts.audit_log} audit entries`
    )
    result.errors.forEach(message => console.log(`  ERROR   ${message}`))
    result.warnings.slice(0, 20).forEach(message => console.log(`  WARNING ${message}`))
    if (result.errors.length) fail('The database has integrity errors.', 2)
  } finally {
    db.close()
  }
}

export { COMMAND_FLAGS }
