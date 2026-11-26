import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawlFailure, CrawlProgress, LibraryCrawlStatus } from '@loci/shared'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { crawlFailures, crawlRuns, documentSources } from './drizzle-schema.js'
import { addColumn, withImmediateTransaction } from './sqlite.js'

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
  finishedAt: string | null
  currentUrl: string | null
  kind: LibraryCrawlStatus['kind']
  requestKey?: string
  cancelled: boolean
  startedAt: string | null
  id: string
  sourceId: string
  status: CrawlHistoryRecord['status']
  progress: CrawlProgress
  error: string | null
}

export interface CrawlHistoryDatabase {
  startCrawlRun: (
    sourceId: string,
    kind?: LibraryCrawlStatus['kind'],
    runId?: string,
    requestKey?: string
  ) => string
  listCrawledSourceIds: () => string[]
  interruptCrawlRun: (id: string) => void
  updateCrawlRunProgress: (id: string, progress: CrawlProgress) => void
  getLatestCrawlRun: (sourceId: string) => CrawlRunSnapshot | undefined
  getActiveCrawlRun: (sourceId: string) => CrawlRunSnapshot | undefined
  getCrawlRun: (id: string) => CrawlRunSnapshot | undefined
  finishCrawlRun: (
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    progress: CrawlProgress | undefined,
    error: string | null
  ) => void
  listCrawlHistory: (sourceId?: string) => CrawlHistoryRecord[]
  listCrawlFailures: (runId: string, limit?: number) => CrawlFailureRecord[]
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
  database.exec('CREATE INDEX IF NOT EXISTS crawl_failures_by_run ON crawl_failures(run_id)')
}

function migrateCrawlFailureReasons(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'crawl_failures'")
    .get() as unknown as { sql: string } | undefined
  if (!row || row.sql.includes('git_lfs_unsupported')) return
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
}

export function createCrawlHistoryDatabase(
  database: DatabaseSync,
  drizzleDatabase: LociDrizzleDatabase
): CrawlHistoryDatabase {
  return {
    listCrawledSourceIds: () =>
      drizzleDatabase
        .selectDistinct({ id: crawlRuns.sourceId })
        .from(crawlRuns)
        .orderBy(crawlRuns.sourceId)
        .all()
        .map((row) => row.id),
    interruptCrawlRun: (id) => {
      const now = new Date().toISOString()
      drizzleDatabase
        .update(crawlRuns)
        .set({
          status: 'failed',
          finishedAt: now,
          updatedAt: now,
          errorMessage: '抓取中断：原进程已退出'
        })
        .where(and(eq(crawlRuns.id, id), eq(crawlRuns.status, 'running')))
        .run()
    },
    startCrawlRun: (sourceId, kind = 'sync', id = randomUUID(), requestKey) => {
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
            `INSERT INTO crawl_runs (id, source_id, status, started_at, updated_at, progress_json)
             VALUES (?, ?, 'running', ?, ?, ?)`
          )
          .run(id, sourceId, now, now, JSON.stringify({ kind, requestKey }))
      })
      return id
    },
    updateCrawlRunProgress: (id, progress) => {
      database
        .prepare(
          `UPDATE crawl_runs SET progress_json = ${progressExpression}, discovered_count = ?, success_count = ?,
             failure_count = ?, updated_at = ? WHERE id = ? AND status = 'running'`
        )
        .run(
          JSON.stringify(progress),
          progress.node?.url ?? null,
          progress.queued,
          progress.succeeded,
          progress.failed,
          new Date().toISOString(),
          id
        )
    },
    getLatestCrawlRun: (sourceId) => {
      const row = drizzleDatabase
        .select()
        .from(crawlRuns)
        .where(and(eq(crawlRuns.sourceId, sourceId), ne(crawlRuns.status, 'queued')))
        .orderBy(desc(crawlRuns.startedAt), sql`rowid DESC`)
        .limit(1)
        .get()
      return row ? toRunSnapshot(row) : undefined
    },
    getActiveCrawlRun: (sourceId) => {
      const row = drizzleDatabase
        .select()
        .from(crawlRuns)
        .where(and(eq(crawlRuns.sourceId, sourceId), eq(crawlRuns.status, 'running')))
        .limit(1)
        .get()
      return row ? toRunSnapshot(row) : undefined
    },
    getCrawlRun: (id) => {
      const row = drizzleDatabase.select().from(crawlRuns).where(eq(crawlRuns.id, id)).get()
      return row ? toRunSnapshot(row) : undefined
    },
    finishCrawlRun: (id, status, progress, error) => {
      withImmediateTransaction(database, () => {
        const last =
          progress === undefined
            ? drizzleDatabase.select().from(crawlRuns).where(eq(crawlRuns.id, id)).get()
            : undefined
        finishCrawlRunRecord(
          database,
          id,
          status,
          progress ?? (last && toRunSnapshot(last).progress),
          error
        )
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
    listCrawlFailures: (runId, limit = -1) => {
      const rows = drizzleDatabase
        .select(failureSelection)
        .from(crawlFailures)
        .where(eq(crawlFailures.runId, runId))
        .orderBy(sql`rowid`)
        .limit(limit)
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

// 保留 v19 的状态 CHECK 和进度结构，扩展字段随原子进度更新一起落盘。
const previousJson = 'CASE WHEN json_valid(progress_json) THEN progress_json END'
const progressExpression = `json_set(?, '$.kind', COALESCE(json_extract(${previousJson}, '$.kind'), 'sync'),
  '$.currentUrl', COALESCE(?, json_extract(${previousJson}, '$.currentUrl')),
  '$.requestKey', json_extract(${previousJson}, '$.requestKey'))`

export function finishCrawlRunRecord(
  database: DatabaseSync,
  id: string,
  status: 'completed' | 'failed' | 'cancelled',
  progress: CrawlProgress | undefined,
  error: string | null
): boolean {
  const now = new Date().toISOString()
  const updated = database
    .prepare(
      `UPDATE crawl_runs
       SET status = ?, finished_at = ?, discovered_count = ?, success_count = ?, failure_count = ?,
           progress_json = ${progressExpression}, error_message = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(
      status === 'cancelled' || (status === 'completed' && progress?.failed && !progress.succeeded)
        ? 'failed'
        : status,
      now,
      progress?.queued ?? 0,
      progress?.succeeded ?? 0,
      progress?.failed ?? 0,
      JSON.stringify({ ...progress, cancelled: status === 'cancelled' }),
      progress?.node?.url ?? null,
      error ??
        progress?.failures?.[0]?.message ??
        (progress?.failed ? `${progress.failed} 个页面抓取失败` : null),
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

type CrawlHistoryRow = Omit<typeof crawlRuns.$inferSelect, 'progressJson' | 'updatedAt'> & {
  sourceName: string
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

function toRunSnapshot(row: typeof crawlRuns.$inferSelect): CrawlRunSnapshot {
  let stored: Partial<CrawlProgress> & {
    currentUrl?: string
    kind?: string
    requestKey?: string
    cancelled?: boolean
  } = {}
  try {
    stored = JSON.parse(row.progressJson ?? '{}') ?? {}
  } catch {
    /* 旧记录使用列中的计数。 */
  }
  const { currentUrl, kind, requestKey, cancelled, ...progress } = stored
  return {
    finishedAt: row.finishedAt,
    currentUrl: currentUrl ?? progress.node?.url ?? null,
    kind: kind === 'pages' ? 'pages' : 'sync',
    ...(typeof requestKey === 'string' && { requestKey }),
    cancelled: cancelled === true,
    id: row.id,
    sourceId: row.sourceId,
    status: row.status,
    startedAt: row.startedAt,
    progress: {
      queued: row.discoveredCount,
      processed: row.successCount + row.failureCount,
      succeeded: row.successCount,
      failed: row.failureCount,
      limitReached: false,
      ...progress
    },
    error: row.errorMessage
  }
}
