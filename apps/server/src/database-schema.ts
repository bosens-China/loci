import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SERVER_CRAWL_SETTINGS } from '@loci/shared'

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
    github_revision TEXT,
    github_blocked_revision TEXT,
    github_blocked_limit_kind TEXT,
    github_blocked_limit_bytes INTEGER,
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
    relative_path TEXT,
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

  CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'canceling', 'canceled', 'completed', 'completed_with_errors', 'failed')
    ),
    owner_id TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    progress_json TEXT,
    failures_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0, 1)),
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
    partial INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
    content_bytes INTEGER NOT NULL DEFAULT 0,
    remaining_urls_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_active_library
    ON sync_jobs(library_id)
    WHERE status IN ('queued', 'running', 'canceling');

  CREATE TABLE IF NOT EXISTS hostname_crawl_policies (
    hostname TEXT PRIMARY KEY,
    http_concurrency INTEGER,
    browser_concurrency INTEGER,
    batch_interval_min_seconds INTEGER,
    batch_interval_max_seconds INTEGER,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS server_crawl_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_concurrent_jobs INTEGER NOT NULL CHECK (max_concurrent_jobs BETWEEN 1 AND 32),
    http_concurrency INTEGER NOT NULL CHECK (http_concurrency BETWEEN 1 AND 32),
    browser_concurrency INTEGER NOT NULL CHECK (browser_concurrency BETWEEN 1 AND 32),
    batch_interval_min_seconds INTEGER NOT NULL,
    batch_interval_max_seconds INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    updated_at TEXT NOT NULL
  ) STRICT;

  INSERT OR IGNORE INTO server_crawl_settings (
    id,
    max_concurrent_jobs,
    http_concurrency,
    browser_concurrency,
    batch_interval_min_seconds,
    batch_interval_max_seconds,
    revision,
    updated_at
  ) VALUES (
    1,
    ${DEFAULT_SERVER_CRAWL_SETTINGS.maxConcurrentJobs},
    ${DEFAULT_SERVER_CRAWL_SETTINGS.httpConcurrency},
    ${DEFAULT_SERVER_CRAWL_SETTINGS.browserConcurrency},
    ${DEFAULT_SERVER_CRAWL_SETTINGS.batchIntervalMinSeconds},
    ${DEFAULT_SERVER_CRAWL_SETTINGS.batchIntervalMaxSeconds},
    1,
    '1970-01-01T00:00:00.000Z'
  );

  CREATE TABLE IF NOT EXISTS publish_requests (
    publish_id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('POST', 'PUT', 'DELETE')),
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at
    ON admin_audit_logs(created_at DESC);
`

/** 初始化当前结构，并兼容迁移只有 hostname 唯一约束的旧版数据库。 */
export function initializeServerDatabase(database: DatabaseSync): void {
  database.exec(schema)
  addColumn(database, 'documents', 'relative_path', 'TEXT')
  addColumn(database, 'libraries', 'github_revision', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_revision', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_limit_kind', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_limit_bytes', 'INTEGER')
  addColumn(database, 'sync_jobs', 'priority', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'paused', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'pause_requested', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'stop_requested', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'partial', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'content_bytes', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'sync_jobs', 'remaining_urls_json', 'TEXT')
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
  addColumn(database, 'libraries', 'github_revision', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_revision', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_limit_kind', 'TEXT')
  addColumn(database, 'libraries', 'github_blocked_limit_bytes', 'INTEGER')
}

function addColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string
  }>
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
