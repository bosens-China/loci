import type { DatabaseSync } from 'node:sqlite'
import type { ExplicitPageResult } from '@loci/core'
import {
  deleteStoredDocument,
  storeDocument,
  type StoredDocument
} from './document-content-database.js'

export type ExplicitPageTargetStatus = 'pending' | 'current' | 'missing' | 'failed'
export type ExplicitPageWriteStatus = 'inserted' | 'updated' | 'unchanged' | 'missing' | 'failed'

export interface ExplicitPageTarget {
  sourceId: string
  url: string
  status: ExplicitPageTargetStatus
  lastCrawledAt: string | null
  lastError: string | null
}

export interface ExplicitPageWriteResult {
  url: string
  status: ExplicitPageWriteStatus
  message?: string
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
    iconUrl: string | null
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

export function createExplicitPageDatabase(database: DatabaseSync): ExplicitPageDatabase {
  return {
    registerExplicitPageTargets: (sourceId, urls) => {
      const now = new Date().toISOString()
      withTransaction(database, () => {
        const insert = database.prepare(
          `INSERT INTO explicit_page_targets
           (source_id, url, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
           ON CONFLICT(source_id, url) DO UPDATE SET updated_at = excluded.updated_at`
        )
        for (const url of new Set(urls)) insert.run(sourceId, url, now, now)
      })
    },
    listExplicitPageTargets: (sourceId) =>
      (
        database
          .prepare(
            `SELECT source_id, url, status, last_crawled_at, last_error
             FROM explicit_page_targets WHERE source_id = ? ORDER BY created_at, url`
          )
          .all(sourceId) as unknown as ExplicitPageTargetRow[]
      ).map(toTarget),
    markExplicitPageTargetsFailed: (sourceId, urls, message) => {
      const now = new Date().toISOString()
      withTransaction(database, () => {
        const update = database.prepare(
          `UPDATE explicit_page_targets
           SET status = 'failed', last_crawled_at = ?, last_error = ?, updated_at = ?
           WHERE source_id = ? AND url = ?`
        )
        for (const url of new Set(urls)) update.run(now, message, now, sourceId, url)
      })
    },
    commitExplicitPageResults: (sourceId, results, fetchMode, iconUrl) =>
      withTransaction(database, () => {
        const written = commitExplicitPageResults(database, sourceId, results, fetchMode)
        database
          .prepare(
            `UPDATE document_sources SET fetch_mode = ?, icon_url = COALESCE(?, icon_url), updated_at = ?
             WHERE id = ? AND source_type = 'local'`
          )
          .run(fetchMode, iconUrl, new Date().toISOString(), sourceId)
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
  const readDocument = database.prepare(
    'SELECT title, markdown, language, fetch_mode FROM documents WHERE source_id = ? AND url = ?'
  )
  const updateTarget = database.prepare(
    `UPDATE explicit_page_targets SET status = ?, last_crawled_at = ?, last_error = ?, updated_at = ?
     WHERE source_id = ? AND url = ?`
  )
  return results.map((result) => {
    const now = new Date().toISOString()
    if (result.status === 'fetched' && result.document) {
      const existing = readDocument.get(sourceId, result.url) as unknown as
        DocumentSnapshot | undefined
      const status = compareDocument(existing, result.document, fetchMode)
      storeDocument(database, { ...result.document, sourceId, fetchMode })
      updateTarget.run('current', now, null, now, sourceId, result.url)
      return { url: result.url, status }
    }
    if (result.status === 'missing') {
      deleteStoredDocument(database, sourceId, result.url)
      updateTarget.run('missing', now, result.failure?.message ?? null, now, sourceId, result.url)
      return { url: result.url, status: 'missing', message: result.failure?.message }
    }
    const message = result.failure?.message ?? '页面抓取失败'
    updateTarget.run('failed', now, message, now, sourceId, result.url)
    return { url: result.url, status: 'failed', message }
  })
}

interface ExplicitPageTargetRow {
  source_id: string
  url: string
  status: ExplicitPageTargetStatus
  last_crawled_at: string | null
  last_error: string | null
}

interface DocumentSnapshot {
  title: string
  markdown: string
  language: string
  fetch_mode: 'http' | 'browser'
}

function toTarget(row: ExplicitPageTargetRow): ExplicitPageTarget {
  return {
    sourceId: row.source_id,
    url: row.url,
    status: row.status,
    lastCrawledAt: row.last_crawled_at,
    lastError: row.last_error
  }
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

function withTransaction<T>(database: DatabaseSync, work: () => T): T {
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
