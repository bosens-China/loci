import type { DatabaseSync } from 'node:sqlite'

export function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  return runTransaction(database, 'BEGIN', work)
}

export function withImmediateTransaction<T>(database: DatabaseSync, work: () => T): T {
  return runTransaction(database, 'BEGIN IMMEDIATE', work)
}

export function addColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): boolean {
  if (hasColumn(database, table, column)) return false
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

export function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string
  }>
  return columns.some((item) => item.name === column)
}

function runTransaction<T>(
  database: DatabaseSync,
  begin: 'BEGIN' | 'BEGIN IMMEDIATE',
  work: () => T
): T {
  database.exec(begin)
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
