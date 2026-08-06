import type { DatabaseSync } from 'node:sqlite'

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_url TEXT NOT NULL,
    hostname TEXT NOT NULL,
    scope_path TEXT NOT NULL DEFAULT '/',
    page_limit INTEGER NOT NULL CHECK (page_limit BETWEEN 1 AND 10000),
    schedule TEXT,
    last_crawled_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(hostname, scope_path)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    language TEXT NOT NULL,
    markdown TEXT NOT NULL,
    crawled_at TEXT NOT NULL,
    UNIQUE(library_id, url)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS library_snapshots (
    library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    published_at TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    content TEXT NOT NULL
  ) STRICT;
`

/** 初始化当前结构，并兼容迁移只有 hostname 唯一约束的旧版数据库。 */
export function initializeServerDatabase(database: DatabaseSync): void {
  database.exec(schema)
  const columns = database.prepare('PRAGMA table_info(libraries)').all() as unknown as Array<{
    name: string
  }>
  if (columns.some((column) => column.name === 'scope_path')) return

  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.exec('BEGIN IMMEDIATE')
    database.exec(`
      CREATE TABLE libraries_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        first_url TEXT NOT NULL,
        hostname TEXT NOT NULL,
        scope_path TEXT NOT NULL DEFAULT '/',
        page_limit INTEGER NOT NULL CHECK (page_limit BETWEEN 1 AND 10000),
        schedule TEXT,
        last_crawled_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(hostname, scope_path)
      ) STRICT;
      INSERT INTO libraries_next
        (id, name, first_url, hostname, scope_path, page_limit, schedule,
          last_crawled_at, last_error, created_at, updated_at)
      SELECT id, name, first_url, hostname, '/', page_limit, schedule,
        last_crawled_at, last_error, created_at, updated_at
      FROM libraries;
      DROP TABLE libraries;
      ALTER TABLE libraries_next RENAME TO libraries;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}
