import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, normalizeUrl } from './crawl/url'
import type {
  CreateSourceInput,
  DocumentRecord,
  DocumentSource,
  UpdateSourceInput
} from '../shared/api'

interface SourceRow {
  id: string
  name: string
  first_url: string
  fetch_mode: 'auto' | 'http' | 'browser'
  page_limit: number
  schedule: string | null
  page_count: number
  last_crawled_at: string | null
}

export interface SourceConfig {
  id: string
  firstUrl: string
  hostname: string
  fetchMode: 'auto' | 'http' | 'browser'
  pageLimit: number
}

export interface StoredDocument {
  sourceId: string
  url: string
  title: string
  markdown: string
  language: string
  fetchMode: 'http' | 'browser'
  crawledAt: string
}

export interface DocHubDatabase {
  listSources: () => DocumentSource[]
  createSource: (input: CreateSourceInput) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  updateResolvedSource: (id: string, firstUrl: string, mode: 'http' | 'browser') => void
  getSourceConfig: (id: string) => SourceConfig
  listDocumentUrls: (sourceId: string) => string[]
  saveDocument: (document: StoredDocument) => void
  deleteDocument: (sourceId: string, url: string) => void
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  deleteSource: (id: string) => void
  close: () => void
}

const schema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS document_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_url TEXT NOT NULL,
    hostname TEXT NOT NULL,
    fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('auto', 'http', 'browser')),
    page_limit INTEGER NOT NULL DEFAULT 1000 CHECK (page_limit BETWEEN 1 AND 10000),
    schedule TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    crawled_at TEXT NOT NULL,
    markdown TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'und',
    fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('http', 'browser')),
    UNIQUE(source_id, url)
  ) STRICT;

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

  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    document_id UNINDEXED,
    source_id UNINDEXED,
    title,
    markdown
  );
`

export function createDatabase(filename: string): DocHubDatabase {
  const database = new DatabaseSync(filename, {
    timeout: 5000,
    enableForeignKeyConstraints: true
  })
  database.exec(schema)

  return {
    listSources: () => {
      const rows = database
        .prepare(
          `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.schedule,
             COUNT(d.id) AS page_count, MAX(d.crawled_at) AS last_crawled_at
           FROM document_sources s
           LEFT JOIN documents d ON d.source_id = s.id
           GROUP BY s.id
           ORDER BY s.updated_at DESC`
        )
        .all() as unknown as SourceRow[]
      return rows.map(toDocumentSource)
    },
    createSource: (input) => {
      validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const now = new Date().toISOString()
      const id = randomUUID()
      database
        .prepare(
          `INSERT INTO document_sources
            (id, name, first_url, hostname, fetch_mode, page_limit, schedule, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(id, input.name.trim(), url, getHostname(url), input.mode, input.pageLimit, now, now)
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, schedule, 0 AS page_count, NULL AS last_crawled_at
         FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateSource: (id, input) => {
      validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const updatedAt = new Date().toISOString()
      const result = database
        .prepare(
          `UPDATE document_sources
           SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(input.name.trim(), url, getHostname(url), input.mode, input.pageLimit, updatedAt, id)
      if (Number(result.changes) !== 1) throw new Error('文档源不存在')
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, schedule,
             (SELECT COUNT(*) FROM documents WHERE source_id = document_sources.id) AS page_count,
             (SELECT MAX(crawled_at) FROM documents WHERE source_id = document_sources.id) AS last_crawled_at
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateResolvedSource: (id, firstUrl, mode) => {
      const url = normalizeUrl(firstUrl)
      database
        .prepare(
          `UPDATE document_sources
           SET first_url = ?, hostname = ?, fetch_mode = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(url, getHostname(url), mode, new Date().toISOString(), id)
    },
    getSourceConfig: (id) => {
      const source = database
        .prepare(
          `SELECT id, first_url, hostname, fetch_mode, page_limit
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as
        | {
            id: string
            first_url: string
            hostname: string
            fetch_mode: SourceConfig['fetchMode']
            page_limit: number
          }
        | undefined
      if (!source) throw new Error('文档源不存在')
      return {
        id: source.id,
        firstUrl: source.first_url,
        hostname: source.hostname,
        fetchMode: source.fetch_mode,
        pageLimit: Number(source.page_limit)
      }
    },
    listDocumentUrls: (sourceId) =>
      (
        database
          .prepare('SELECT url FROM documents WHERE source_id = ? ORDER BY crawled_at ASC')
          .all(sourceId) as unknown as { url: string }[]
      ).map((row) => row.url),
    saveDocument: (document) =>
      withTransaction(database, () => {
        const id = randomUUID()
        database
          .prepare(
            `INSERT INTO documents
            (id, source_id, title, url, crawled_at, markdown, language, fetch_mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id, url) DO UPDATE SET
             title = excluded.title,
             crawled_at = excluded.crawled_at,
             markdown = excluded.markdown,
             language = excluded.language,
             fetch_mode = excluded.fetch_mode`
          )
          .run(
            id,
            document.sourceId,
            document.title,
            document.url,
            document.crawledAt,
            document.markdown,
            document.language,
            document.fetchMode
          )
        const saved = database
          .prepare('SELECT id FROM documents WHERE source_id = ? AND url = ?')
          .get(document.sourceId, document.url) as unknown as { id: string }
        database.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(saved.id)
        database
          .prepare(
            'INSERT INTO documents_fts (document_id, source_id, title, markdown) VALUES (?, ?, ?, ?)'
          )
          .run(saved.id, document.sourceId, document.title, document.markdown)
      }),
    deleteDocument: (sourceId, url) => {
      const document = database
        .prepare('SELECT id FROM documents WHERE source_id = ? AND url = ?')
        .get(sourceId, url) as unknown as { id: string } | undefined
      if (!document) return
      database.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(document.id)
      database.prepare('DELETE FROM documents WHERE id = ?').run(document.id)
    },
    listDocuments: () => {
      const rows = database
        .prepare(
          `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.url,
             d.language, d.crawled_at, d.markdown
           FROM documents d
           JOIN document_sources s ON s.id = d.source_id
           ORDER BY d.crawled_at DESC`
        )
        .all() as unknown as DocumentRow[]
      return rows.map(toDocumentRecord)
    },
    searchDocuments: (query) => {
      const expression = toFtsExpression(query)
      if (!expression) return []
      const rows = database
        .prepare(
          `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.url,
             d.language, d.crawled_at, d.markdown
           FROM documents_fts f
           JOIN documents d ON d.id = f.document_id
           JOIN document_sources s ON s.id = d.source_id
           WHERE documents_fts MATCH ?
           ORDER BY rank`
        )
        .all(expression) as unknown as DocumentRow[]
      return rows.map(toDocumentRecord)
    },
    deleteSource: (id) => {
      database.prepare('DELETE FROM document_sources WHERE id = ?').run(id)
    },
    close: () => database.close()
  }
}

interface DocumentRow {
  id: string
  source_id: string
  source_name: string
  title: string
  url: string
  language: string
  crawled_at: string
  markdown: string
}

function validateSourceInput(input: CreateSourceInput): void {
  if (!input.name.trim()) throw new Error('文档源名称不能为空')
  if (!Number.isInteger(input.pageLimit) || input.pageLimit < 1 || input.pageLimit > 10000) {
    throw new Error('页面上限必须在 1 到 10000 之间')
  }
  if (!['auto', 'http', 'browser'].includes(input.mode)) throw new Error('不支持的抓取方式')
}

function toDocumentSource(row: SourceRow): DocumentSource {
  return {
    id: row.id,
    name: row.name,
    url: row.first_url,
    mode: row.fetch_mode,
    status: 'healthy',
    pages: Number(row.page_count),
    pageLimit: Number(row.page_limit),
    lastUpdated: row.last_crawled_at ? formatDate(row.last_crawled_at) : '尚未更新',
    schedule: row.schedule ?? '关闭'
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  const path = new URL(row.url).pathname.split('/').filter(Boolean)
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    url: row.url,
    folder: path.slice(0, -1).join(' / ') || row.source_name,
    language: row.language,
    updatedAt: formatDate(row.crawled_at),
    content: row.markdown
  }
}

function toFtsExpression(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' AND ')
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
