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

export interface CrawlHistoryDatabase {
  startCrawlRun: (sourceId: string) => string
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
        reason IN ('not_found', 'out_of_scope_redirect', 'http_error', 'request_error')
      ),
      message TEXT NOT NULL,
      retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
      status_code INTEGER,
      redirect_url TEXT
    ) STRICT;
  `)
}

export function createCrawlHistoryDatabase(database: DatabaseSync): CrawlHistoryDatabase {
  return {
    startCrawlRun: (sourceId) => {
      const id = randomUUID()
      database
        .prepare(
          `INSERT INTO crawl_runs (id, source_id, status, started_at)
           VALUES (?, ?, 'running', ?)`
        )
        .run(id, sourceId, new Date().toISOString())
      return id
    },
    finishCrawlRun: (id, status, progress, error) => {
      withTransaction(database, () => {
        database
          .prepare(
            `UPDATE crawl_runs
             SET status = ?, finished_at = ?, discovered_count = ?, success_count = ?, failure_count = ?, error_message = ?
             WHERE id = ?`
          )
          .run(
            status,
            new Date().toISOString(),
            progress?.queued ?? 0,
            progress?.succeeded ?? 0,
            progress?.failed ?? 0,
            error,
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
