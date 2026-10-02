// The public surface of the server: what app.tsx, the Electron shell, the scripts and the tests import.
export { createApp } from './app/create-app'
export { createContainer, type Container } from './app/container'
export { type RunningServer, type StartOptions, startServer } from './app/lifecycle'
export { CliError, runCommand } from './cli/commands'
export { type AtlasConfig, loadConfig } from './config'
export { type BackupInfo, createBackup, listBackupsIn, restoreBackup } from './db/backup'
export { Database } from './db/driver'
export {
  SchemaMismatchError,
  StoreCorruptError,
  StoreLockedError,
  StoreMissingError,
  StoreTooNewError
} from './db/errors'
export { openDatabase } from './db/open'
export { explainStartupError, isEntryPoint, main } from './main'
