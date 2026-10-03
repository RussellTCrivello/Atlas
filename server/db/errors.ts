// Errors raised while opening or restoring the database. Each one means "stop and tell the person", never "fix it
// silently": an unreadable or surprising database must not be replaced by an empty workspace (which would reopen
// first-run setup to anyone who can reach the port).
import type { BackupInfo } from './backup'

export interface LockInfo {
  pid: number
  hostname: string
  startedAt: string
  token: string
}

export class StoreLockedError extends Error {
  constructor(
    message: string,
    public info?: LockInfo
  ) {
    super(message)
    this.name = 'StoreLockedError'
  }
}

export class StoreCorruptError extends Error {
  constructor(
    message: string,
    public file: string,
    public backups: BackupInfo[] = []
  ) {
    super(message)
    this.name = 'StoreCorruptError'
  }
}

export class StoreTooNewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoreTooNewError'
  }
}

export class StoreMissingError extends Error {
  constructor(
    message: string,
    public backups: BackupInfo[]
  ) {
    super(message)
    this.name = 'StoreMissingError'
  }
}

/** The applied schema history no longer matches this build's migrations (someone edited a released migration). */
export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaMismatchError'
  }
}
