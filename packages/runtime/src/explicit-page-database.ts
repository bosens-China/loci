import type { DatabaseSync } from 'node:sqlite'
import type { ExplicitPageResult } from '@loci/core'
import type { ExplicitPageWriteResult, ExplicitPageWriteStatus, CrawlProgress } from '@loci/shared'
import { finishCrawlRunRecord } from './crawl-history-database.js'
import { eq } from 'drizzle-orm'
import {
  deleteStoredDocument,
  storeDocument,
  type StoredDocument
} from './document-content-database.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { explicitPageTargets } from './drizzle-schema.js'
import { withImmediateTransaction as withTransaction } from './sqlite.js'

export type ExplicitPageTargetStatus = 'pending' | 'current' | 'missing' | 'failed'
export type { ExplicitPageWriteStatus, ExplicitPageWriteResult } from '@loci/shared'

export interface ExplicitPageTarget {
  sourceId: string
  url: string
  status: ExplicitPageTargetStatus
  lastCrawledAt: string | null
  lastError: string | null
}

export interface ExplicitPageDatabase {
  registerExplicitPageTargets: (sourceId: string, urls: readonly string[]) => void
  listExplicitPageTargets: (sourceId: string) => ExplicitPageTarget[]
  markExplicitPageTargetsFailed: (
    sourceId: string,
    urls: readonly string[],
    message: string
  ) => void
  commitExplicitPageResults: (
    sourceId: string,
    results: readonly ExplicitPageResult[],
    fetchMode: 'http' | 'browser',
    iconUrl: string | null,
    run?: { id: string; progress: CrawlProgress; error?: string }
  ) => ExplicitPageWriteResult[]
}

export function initializeExplicitPageDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS explicit_page_targets (
      source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'current', 'missing', 'failed')),
      last_crawled_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_id, url)
    ) STRICT;
  `)
}

/** 调用方持有写事务，批量插入的目标与终态结果一并提交。 */
function register(database: DatabaseSync, sourceId: string, urls: readonly string[]) {
  const now = new Date().toISOString()
  const insert = database.prepare(
    `INSERT INTO explicit_page_targets (source_id,url,status,created_at,updated_at) VALUES (?,?,'pending',?,?) ON CONFLICT(source_id,url) DO NOTHING`
  )
  for (const url of new Set(urls)) insert.run(sourceId, url, now, now)
}

export function createExplicitPageDatabase(
  database: DatabaseSync,
  drizzleDatabase: LociDrizzleDatabase
): ExplicitPageDatabase {
  return {
    registerExplicitPageTargets: (sourceId, urls) =>
      withTransaction(database, () => register(database, sourceId, urls)),
    listExplicitPageTargets: (sourceId) =>
      drizzleDatabase
        .select({
          sourceId: explicitPageTargets.sourceId,
          url: explicitPageTargets.url,
          status: explicitPageTargets.status,
          lastCrawledAt: explicitPageTargets.lastCrawledAt,
          lastError: explicitPageTargets.lastError
        })
        .from(explicitPageTargets)
        .where(eq(explicitPageTargets.sourceId, sourceId))
        .orderBy(explicitPageTargets.createdAt, explicitPageTargets.url)
        .all(),
    markExplicitPageTargetsFailed: (sourceId, urls, message) => {
      const now = new Date().toISOString()
      withTransaction(database, () => {
        register(database, sourceId, urls)
        const update = database.prepare(
          `UPDATE explicit_page_targets
           SET status = 'failed', last_crawled_at = ?, last_error = ?, updated_at = ?
           WHERE source_id = ? AND url = ?`
        )
        for (const url of new Set(urls)) update.run(now, message, now, sourceId, url)
      })
    },
    commitExplicitPageResults: (sourceId, results, fetchMode, iconUrl, run) =>
      withTransaction(database, () => {
        const written = commitExplicitPageResults(database, sourceId, results, fetchMode)
        database
          .prepare(
            `UPDATE document_sources SET fetch_mode = ?, icon_url = COALESCE(?, icon_url), updated_at = ?
             WHERE id = ? AND source_type = 'local'`
          )
          .run(fetchMode, iconUrl, new Date().toISOString(), sourceId)
        if (
          run &&
          !finishCrawlRunRecord(database, run.id, 'completed', run.progress, run.error ?? null)
        )
          throw new Error('抓取运行状态已变化')
        return written
      })
  }
}

export function commitExplicitPageResults(
  database: DatabaseSync,
  sourceId: string,
  results: readonly ExplicitPageResult[],
  fetchMode: 'http' | 'browser'
): ExplicitPageWriteResult[] {
  register(
    database,
    sourceId,
    results.map((result) => result.url)
  )
  const readDocument = database.prepare(
    'SELECT title, markdown, language, fetch_mode, manual FROM documents WHERE source_id = ? AND url = ?'
  )
  const updateTarget = database.prepare(
    `UPDATE explicit_page_targets SET status = ?, last_crawled_at = ?, last_error = ?, updated_at = ?
     WHERE source_id = ? AND url = ?`
  )
  return results.map((result) => {
    const now = new Date().toISOString()
    const existing = readDocument.get(sourceId, result.url) as unknown as
      DocumentSnapshot | undefined
    if (result.status === 'fetched' && result.document) {
      const status = existing?.manual
        ? 'unchanged'
        : compareDocument(existing, result.document, fetchMode)
      if (!existing?.manual) storeDocument(database, { ...result.document, sourceId, fetchMode })
      updateTarget.run('current', now, null, now, sourceId, result.url)
      return { url: result.url, status }
    }
    if (result.status === 'missing') {
      // 远端状态仍可报告 404，手工正文和索引由用户管理。
      if (!existing?.manual) deleteStoredDocument(database, sourceId, result.url)
      updateTarget.run('missing', now, result.failure?.message ?? null, now, sourceId, result.url)
      return { url: result.url, status: 'missing', message: result.failure?.message }
    }
    const message = result.failure?.message ?? '页面抓取失败'
    updateTarget.run('failed', now, message, now, sourceId, result.url)
    return { url: result.url, status: 'failed', message }
  })
}

interface DocumentSnapshot {
  title: string
  markdown: string
  language: string
  fetch_mode: 'http' | 'browser'
  manual: number
}

function compareDocument(
  existing: DocumentSnapshot | undefined,
  document: Omit<StoredDocument, 'sourceId'>,
  fetchMode: 'http' | 'browser'
): Extract<ExplicitPageWriteStatus, 'inserted' | 'updated' | 'unchanged'> {
  if (!existing) return 'inserted'
  return existing.title === document.title &&
    existing.markdown === document.markdown &&
    existing.language === document.language &&
    existing.fetch_mode === fetchMode
    ? 'unchanged'
    : 'updated'
}
