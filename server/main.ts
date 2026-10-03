// Process entry: run a command if one was given, otherwise start the server and shut it down cleanly on SIGINT/SIGTERM.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startServer } from './app/lifecycle'
import { CliError, runCommand } from './cli/commands'
import { type AtlasConfig, loadConfig } from './config'
import { BACKUP_DIR } from './db/backup'
import {
  SchemaMismatchError,
  StoreCorruptError,
  StoreLockedError,
  StoreMissingError,
  StoreTooNewError
} from './db/errors'

export function explainStartupError(error: unknown, config: AtlasConfig) {
  if (error instanceof StoreLockedError) console.error(`\n${error.message}\n`)
  else if (error instanceof StoreCorruptError) {
    console.error(`\nAtlas cannot start: ${error.message}`)
    console.error('The file was NOT modified or replaced. To recover:')
    if (error.backups.length) {
      console.error(
        `  1. Restore the newest valid backup:   npm run restore:data -- latest   (stop any running server first)`
      )
      console.error(`     Available backups (${error.backups.length}):`)
      error.backups
        .slice(0, 5)
        .forEach(backup => console.error(`       ${backup.createdAt}  ${backup.reason}  ${backup.file}`))
    } else
      console.error(
        `  There are no backups in ${path.join(config.dataDir, BACKUP_DIR)}. Inspect or repair ${error.file} by hand.`
      )
    console.error('')
  } else if (
    error instanceof StoreMissingError ||
    error instanceof StoreTooNewError ||
    error instanceof SchemaMismatchError
  )
    console.error(`\nAtlas cannot start: ${error.message}\n`)
  else console.error(error)
}

/** Entry point for `npm run app`, `npm start` and the CLI flags. */
export async function main(argv = process.argv.slice(2)) {
  const config = loadConfig()
  try {
    if (await runCommand(argv, config)) return
    const running = await startServer(config, { banner: true })
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down…`)
      try {
        await running.close()
      } finally {
        process.exit(0)
      }
    }
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message)
      process.exit(error.exitCode)
    }
    explainStartupError(error, config)
    process.exit(1)
  }
}

/** True when this module graph was started directly (not imported by Electron, tests or another program). */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(fs.realpathSync(entry)).href === moduleUrl
  } catch {
    return false
  }
}
