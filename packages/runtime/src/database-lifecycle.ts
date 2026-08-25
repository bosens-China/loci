import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { LOCI_SCHEMA_VERSION } from './database-schema.js'

export function databaseNeedsMigration(filename: string): boolean {
  if (filename === ':memory:' || !existsSync(filename)) return true
  const database = new DatabaseSync(filename, { readOnly: true })
  try {
    const row = database.prepare('PRAGMA user_version').get() as unknown as {
      user_version: number
    }
    return row.user_version < LOCI_SCHEMA_VERSION
  } finally {
    database.close()
  }
}
