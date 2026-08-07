import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawlFailure, CrawlProgress } from '@loci/shared'

export interface CrawlHistoryRecord {
  id: string
  sourceId: string
  sourceName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  discovered: number
  succeeded: number
  failed: number
  error: string | null
}

export interface CrawlFailureRecord extends CrawlFailure {
  runId: string
}

export interface CrawlRunSnapshot {
  id: string
  sourceId: string
  status: CrawlHistoryRecord['status']
  progress: CrawlProgress
  error: string | null
}

export interface CrawlHistoryDatabase {
  startCrawlRun: (sourceId: string) => string
  updateCrawlRunProgress: (id: string, progress: CrawlProgress) => void
  getActiveCrawlRun: (sourceId: string) => CrawlRunSnapshot | undefined
  getCrawlRun: (id: string) => CrawlRunSnapshot | undefined
  finishCrawlRun: (
    id: string,
    status: 'completed' | 'failed',
    progress: CrawlProgress | undefined,
    error: string | null
  ) => void
  listCrawlHistory: (sourceId?: string) => CrawlHistoryRecord[]
  listCrawlFailures: (runId: string) => CrawlFailureRecord[]
}

export function initializeCrawlHistoryDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      started_at TEXT,
      finished_at TEXT,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS crawl_failures (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (
        reason IN ('not_found', 'out_of_scope_redirect', 'http_error', 'request_error', 'git_lfs_unsupported')
      ),
      message TEXT NOT NULL,
      retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
      status_code INTEGER,
      redirect_url TEXT
    ) STRICT;
  `)
  addColumn(database, 'crawl_runs', 'progress_json', 'TEXT')
  addColumn(database, 'crawl_runs', 'updated_at', 'TEXT')
  database.exec(
    `UPDATE crawl_runs SET status = 'failed', finished_at = COALESCE(finished_at, started_at),
       error_message = COALESCE(error_message, '重复活动任务已在迁移时收口')
     WHERE status = 'running' AND rowid NOT IN (
       SELECT MAX(rowid) FROM crawl_runs WHERE status = 'running' GROUP BY source_id
     )`
  )
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS crawl_runs_active_source
     ON crawl_runs(source_id) WHERE status = 'running'`
  )
  migrateCrawlFailureReasons(database)
}

function migrateCrawlFailureReasons(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'crawl_failures'")
    .get() as unknown as { sql: string } | undefined
  if (!row || row.sql.includes('git_lfs_unsupported')) return
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
    CREATE TABLE crawl_failures_next (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (
        reason IN ('not_found', 'out_of_scope_redirect', 'http_error', 'request_error', 'git_lfs_unsupported')
      ),
      message TEXT NOT NULL,
      retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
      status_code INTEGER,
      redirect_url TEXT
    ) STRICT;
    INSERT INTO crawl_failures_next SELECT * FROM crawl_failures;
    DROP TABLE crawl_failures;
    ALTER TABLE crawl_failures_next RENAME TO crawl_failures;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function createCrawlHistoryDatabase(database: DatabaseSync): CrawlHistoryDatabase {
  return {
    startCrawlRun: (sourceId) => {
      const id = randomUUID()
      withImmediateTransaction(database, () => {
        const now = new Date().toISOString()
        database
          .prepare(
            `UPDATE crawl_runs SET status = 'failed', finished_at = ?, updated_at = ?,
               error_message = '上一次任务进程已退出'
             WHERE source_id = ? AND status = 'running'`
          )
          .run(now, now, sourceId)
        database
          .prepare(
            `INSERT INTO crawl_runs (id, source_id, status, started_at, updated_at)
             VALUES (?, ?, 'running', ?, ?)`
          )
          .run(id, sourceId, now, now)
      })
      return id
    },
    updateCrawlRunProgress: (id, progress) => {
      database
        .prepare(
          `UPDATE crawl_runs SET progress_json = ?, discovered_count = ?, success_count = ?,
             failure_count = ?, updated_at = ? WHERE id = ? AND status = 'running'`
        )
        .run(
          JSON.stringify(withoutNode(progress)),
          progress.queued,
          progress.succeeded,
          progress.failed,
          new Date().toISOString(),
          id
        )
    },
    getActiveCrawlRun: (sourceId) => {
      const row = database
        .prepare(`${runQuery} WHERE source_id = ? AND status = 'running' LIMIT 1`)
        .get(sourceId) as unknown as CrawlRunSnapshotRow | undefined
      return row ? toRunSnapshot(row) : undefined
    },
    getCrawlRun: (id) => {
      const row = database.prepare(`${runQuery} WHERE id = ?`).get(id) as unknown as
        CrawlRunSnapshotRow | undefined
      return row ? toRunSnapshot(row) : undefined
    },
    finishCrawlRun: (id, status, progress, error) => {
      withTransaction(database, () => {
        database
          .prepare(
            `UPDATE crawl_runs
             SET status = ?, finished_at = ?, discovered_count = ?, success_count = ?, failure_count = ?,
                 progress_json = ?, error_message = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            status,
            new Date().toISOString(),
            progress?.queued ?? 0,
            progress?.succeeded ?? 0,
            progress?.failed ?? 0,
            progress ? JSON.stringify(withoutNode(progress)) : null,
            error,
            new Date().toISOString(),
            id
          )
        database.prepare('DELETE FROM crawl_failures WHERE run_id = ?').run(id)
        const insert = database.prepare(
          `INSERT INTO crawl_failures
           (id, run_id, url, reason, message, retryable, status_code, redirect_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const failure of progress?.failures ?? []) {
          insert.run(
            randomUUID(),
            id,
            failure.url,
            failure.reason,
            failure.message,
            Number(failure.retryable),
            failure.statusCode ?? null,
            failure.redirectUrl ?? null
          )
        }
      })
    },
    listCrawlHistory: (sourceId) => {
      const rows = (sourceId
        ? database
            .prepare(`${historyQuery} WHERE r.source_id = ? ORDER BY r.started_at DESC LIMIT 50`)
            .all(sourceId)
        : database
            .prepare(`${historyQuery} ORDER BY r.started_at DESC LIMIT 50`)
            .all()) as unknown as CrawlHistoryRow[]
      return rows.map(toCrawlHistoryRecord)
    },
    listCrawlFailures: (runId) => {
      const rows = database
        .prepare(
          `SELECT run_id, url, reason, message, retryable, status_code, redirect_url
           FROM crawl_failures WHERE run_id = ? ORDER BY rowid`
        )
        .all(runId) as unknown as CrawlFailureRow[]
      return rows.map((row) => ({
        runId: row.run_id,
        url: row.url,
        reason: row.reason,
        message: row.message,
        retryable: Boolean(row.retryable),
        ...(row.status_code === null ? {} : { statusCode: Number(row.status_code) }),
        ...(row.redirect_url ? { redirectUrl: row.redirect_url } : {})
      }))
    }
  }
}

const historyQuery = `
  SELECT r.id, r.source_id, s.name AS source_name, r.status, r.started_at,
    r.finished_at, r.discovered_count, r.success_count, r.failure_count, r.error_message
  FROM crawl_runs r JOIN document_sources s ON s.id = r.source_id`

interface CrawlHistoryRow {
  id: string
  source_id: string
  source_name: string
  status: CrawlHistoryRecord['status']
  started_at: string | null
  finished_at: string | null
  discovered_count: number
  success_count: number
  failure_count: number
  error_message: string | null
}

interface CrawlFailureRow {
  run_id: string
  url: string
  reason: CrawlFailure['reason']
  message: string
  retryable: number
  status_code: number | null
  redirect_url: string | null
}

interface CrawlRunSnapshotRow {
  id: string
  source_id: string
  status: CrawlHistoryRecord['status']
  progress_json: string | null
  discovered_count: number
  success_count: number
  failure_count: number
  error_message: string | null
}

function toCrawlHistoryRecord(row: CrawlHistoryRow): CrawlHistoryRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    discovered: Number(row.discovered_count),
    succeeded: Number(row.success_count),
    failed: Number(row.failure_count),
    error: row.error_message
  }
}

function toRunSnapshot(row: CrawlRunSnapshotRow): CrawlRunSnapshot {
  let progress: CrawlProgress | undefined
  try {
    progress = row.progress_json ? (JSON.parse(row.progress_json) as CrawlProgress) : undefined
  } catch {
    progress = undefined
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    progress: progress ?? {
      queued: Number(row.discovered_count),
      processed: Number(row.success_count) + Number(row.failure_count),
      succeeded: Number(row.success_count),
      failed: Number(row.failure_count),
      limitReached: false
    },
    error: row.error_message
  }
}

function withoutNode(progress: CrawlProgress): CrawlProgress {
  const snapshot = { ...progress }
  delete snapshot.node
  return snapshot
}

function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function withImmediateTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
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

const runQuery = `SELECT id, source_id, status, progress_json, discovered_count,
  success_count, failure_count, error_message FROM crawl_runs`
