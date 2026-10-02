// The ordered list of schema migrations. A released migration is never edited: its checksum is recorded when it is
// applied, and a database whose recorded checksum differs from the code is refused (see migrator.ts). A change to the
// schema is a new file with the next version number.
import { initialSchema } from './001-initial-schema'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [initialSchema]

/** The schema version this build writes and understands. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** Stored in the database header (PRAGMA application_id) so a stray SQLite file is not mistaken for an Atlas database. */
export const APPLICATION_ID = 0x41544c53 // "ATLS"
