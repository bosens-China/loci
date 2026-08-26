import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawlFailure, CrawlProgress } from '@loci/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { crawlFailures, crawlRuns, documentSources } from './drizzle-schema.js'
import { addColumn, withImmediateTransaction, withTransaction } from './sqlite.js'

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
  withImmediateTransaction(database, () => {
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
  })
}

export function createCrawlHistoryDatabase(
  database: DatabaseSync,
  drizzleDatabase: LociDrizzleDatabase
): CrawlHistoryDatabase {
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
      const row = drizzleDatabase
        .select(runSelection)
        .from(crawlRuns)
        .where(and(eq(crawlRuns.sourceId, sourceId), eq(crawlRuns.status, 'running')))
        .limit(1)
        .get()
      return row ? toRunSnapshot(row) : undefined
    },
    getCrawlRun: (id) => {
      const row = drizzleDatabase
        .select(runSelection)
        .from(crawlRuns)
        .where(eq(crawlRuns.id, id))
        .get()
      return row ? toRunSnapshot(row) : undefined
    },
    finishCrawlRun: (id, status, progress, error) => {
      withTransaction(database, () => {
        finishCrawlRunRecord(database, id, status, progress, error)
      })
    },
    listCrawlHistory: (sourceId) => {
      const rows = drizzleDatabase
        .select(historySelection)
        .from(crawlRuns)
        .innerJoin(documentSources, eq(documentSources.id, crawlRuns.sourceId))
        .where(sourceId ? eq(crawlRuns.sourceId, sourceId) : undefined)
        .orderBy(desc(crawlRuns.startedAt))
        .limit(50)
        .all()
      return rows.map(toCrawlHistoryRecord)
    },
    listCrawlFailures: (runId) => {
      const rows = drizzleDatabase
        .select(failureSelection)
        .from(crawlFailures)
        .where(eq(crawlFailures.runId, runId))
        .orderBy(sql`rowid`)
        .all()
      return rows.map((row) => ({
        runId: row.runId,
        url: row.url,
        reason: row.reason,
        message: row.message,
        retryable: Boolean(row.retryable),
        ...(row.statusCode === null ? {} : { statusCode: row.statusCode }),
        ...(row.redirectUrl ? { redirectUrl: row.redirectUrl } : {})
      }))
    }
  }
}

export function finishCrawlRunRecord(
  database: DatabaseSync,
  id: string,
  status: 'completed' | 'failed',
  progress: CrawlProgress | undefined,
  error: string | null
): boolean {
  const now = new Date().toISOString()
  const updated = database
    .prepare(
      `UPDATE crawl_runs
       SET status = ?, finished_at = ?, discovered_count = ?, success_count = ?, failure_count = ?,
           progress_json = ?, error_message = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(
      status,
      now,
      progress?.queued ?? 0,
      progress?.succeeded ?? 0,
      progress?.failed ?? 0,
      progress ? JSON.stringify(withoutNode(progress)) : null,
      error,
      now,
      id
    )
  if (updated.changes !== 1) return false
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
  return true
}

const historySelection = {
  id: crawlRuns.id,
  sourceId: crawlRuns.sourceId,
  sourceName: documentSources.name,
  status: crawlRuns.status,
  startedAt: crawlRuns.startedAt,
  finishedAt: crawlRuns.finishedAt,
  discoveredCount: crawlRuns.discoveredCount,
  successCount: crawlRuns.successCount,
  failureCount: crawlRuns.failureCount,
  errorMessage: crawlRuns.errorMessage
}

interface CrawlHistoryRow {
  id: string
  sourceId: string
  sourceName: string
  status: CrawlHistoryRecord['status']
  startedAt: string | null
  finishedAt: string | null
  discoveredCount: number
  successCount: number
  failureCount: number
  errorMessage: string | null
}

const failureSelection = {
  runId: crawlFailures.runId,
  url: crawlFailures.url,
  reason: crawlFailures.reason,
  message: crawlFailures.message,
  retryable: crawlFailures.retryable,
  statusCode: crawlFailures.statusCode,
  redirectUrl: crawlFailures.redirectUrl
}

const runSelection = {
  id: crawlRuns.id,
  sourceId: crawlRuns.sourceId,
  status: crawlRuns.status,
  progressJson: crawlRuns.progressJson,
  discoveredCount: crawlRuns.discoveredCount,
  successCount: crawlRuns.successCount,
  failureCount: crawlRuns.failureCount,
  errorMessage: crawlRuns.errorMessage
}

interface CrawlRunSnapshotRow {
  id: string
  sourceId: string
  status: CrawlHistoryRecord['status']
  progressJson: string | null
  discoveredCount: number
  successCount: number
  failureCount: number
  errorMessage: string | null
}

function toCrawlHistoryRecord(row: CrawlHistoryRow): CrawlHistoryRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    discovered: row.discoveredCount,
    succeeded: row.successCount,
    failed: row.failureCount,
    error: row.errorMessage
  }
}

function toRunSnapshot(row: CrawlRunSnapshotRow): CrawlRunSnapshot {
  let progress: CrawlProgress | undefined
  try {
    progress = row.progressJson ? (JSON.parse(row.progressJson) as CrawlProgress) : undefined
  } catch {
    progress = undefined
  }
  return {
    id: row.id,
    sourceId: row.sourceId,
    status: row.status,
    progress: progress ?? {
      queued: row.discoveredCount,
      processed: row.successCount + row.failureCount,
      succeeded: row.successCount,
      failed: row.failureCount,
      limitReached: false
    },
    error: row.errorMessage
  }
}

function withoutNode(progress: CrawlProgress): CrawlProgress {
  const snapshot = { ...progress }
  delete snapshot.node
  return snapshot
}
