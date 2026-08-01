import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, normalizeUrl } from './crawl/url'
import {
  type DocumentRow,
  migrateDatabase,
  type SourceRow,
  toDocumentRecord,
  toDocumentSource,
  toFtsExpression,
  validateSettings,
  validateSourceInput
} from './database-values'
import type {
  AppSettings,
  CreateSourceInput,
  DocumentRecord,
  DocumentSource,
  UpdateSourceInput
} from '../shared/api'
import { DEFAULT_APP_SETTINGS } from '../shared/api'

export interface SourceConfig {
  id: string
  firstUrl: string
  hostname: string
  fetchMode: 'auto' | 'http' | 'browser'
  pageLimit: number
  concurrency: number | null
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
  updateResolvedSource: (
    id: string,
    firstUrl: string,
    mode: 'http' | 'browser',
    iconUrl: string | null
  ) => void
  getSourceConfig: (id: string) => SourceConfig
  listDocumentUrls: (sourceId: string) => string[]
  saveDocument: (document: StoredDocument) => void
  deleteDocument: (sourceId: string, url: string) => void
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  deleteSource: (id: string) => void
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => AppSettings
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
    concurrency INTEGER CHECK (concurrency IS NULL OR concurrency BETWEEN 1 AND 32),
    icon_url TEXT,
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

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mcp_port INTEGER NOT NULL CHECK (mcp_port BETWEEN 1024 AND 65535),
    theme TEXT NOT NULL CHECK (theme IN ('auto', 'light', 'dark')),
    http_concurrency INTEGER NOT NULL DEFAULT 9 CHECK (http_concurrency BETWEEN 1 AND 32),
    browser_concurrency INTEGER NOT NULL DEFAULT 2 CHECK (browser_concurrency BETWEEN 1 AND 32)
  ) STRICT;

  INSERT OR IGNORE INTO app_settings (id, mcp_port, theme)
  VALUES (1, ${DEFAULT_APP_SETTINGS.mcpPort}, '${DEFAULT_APP_SETTINGS.theme}');
`

export function createDatabase(filename: string): DocHubDatabase {
  const database = new DatabaseSync(filename, {
    timeout: 5000,
    enableForeignKeyConstraints: true
  })
  database.exec(schema)
  migrateDatabase(database)

  return {
    listSources: () => {
      const rows = database
        .prepare(
          `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.schedule,
             s.concurrency, s.icon_url,
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
      const schedule = validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const hostname = getHostname(url)
      const existing = database
        .prepare('SELECT id FROM document_sources WHERE hostname = ?')
        .get(hostname)
      if (existing) throw new Error('这个域名已经存在于文档源中')
      const now = new Date().toISOString()
      const id = randomUUID()
      database
        .prepare(
          `INSERT INTO document_sources
           (id, name, first_url, hostname, fetch_mode, page_limit, schedule, concurrency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.name.trim(),
          url,
          hostname,
          input.mode,
          input.pageLimit,
          schedule,
          input.concurrency,
          now,
          now
        )
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, schedule, concurrency, icon_url,
             0 AS page_count, NULL AS last_crawled_at
         FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateSource: (id, input) => {
      const schedule = validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const updatedAt = new Date().toISOString()
      const result = database
        .prepare(
          `UPDATE document_sources
           SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, schedule = ?, concurrency = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name.trim(),
          url,
          getHostname(url),
          input.mode,
          input.pageLimit,
          schedule,
          input.concurrency,
          updatedAt,
          id
        )
      if (Number(result.changes) !== 1) throw new Error('文档源不存在')
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, schedule, concurrency, icon_url,
             (SELECT COUNT(*) FROM documents WHERE source_id = document_sources.id) AS page_count,
             (SELECT MAX(crawled_at) FROM documents WHERE source_id = document_sources.id) AS last_crawled_at
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateResolvedSource: (id, firstUrl, mode, iconUrl) => {
      const url = normalizeUrl(firstUrl)
      database
        .prepare(
          `UPDATE document_sources
           SET first_url = ?, hostname = ?, fetch_mode = ?, icon_url = COALESCE(?, icon_url), updated_at = ?
           WHERE id = ?`
        )
        .run(url, getHostname(url), mode, iconUrl, new Date().toISOString(), id)
    },
    getSourceConfig: (id) => {
      const source = database
        .prepare(
          `SELECT id, first_url, hostname, fetch_mode, page_limit, concurrency
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as
        | {
            id: string
            first_url: string
            hostname: string
            fetch_mode: SourceConfig['fetchMode']
            page_limit: number
            concurrency: number | null
          }
        | undefined
      if (!source) throw new Error('文档源不存在')
      return {
        id: source.id,
        firstUrl: source.first_url,
        hostname: source.hostname,
        fetchMode: source.fetch_mode,
        pageLimit: Number(source.page_limit),
        concurrency: source.concurrency === null ? null : Number(source.concurrency)
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
      withTransaction(database, () => {
        database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(id)
        database.prepare('DELETE FROM document_sources WHERE id = ?').run(id)
      })
    },
    getSettings: () => {
      const row = database
        .prepare(
          'SELECT mcp_port, theme, http_concurrency, browser_concurrency FROM app_settings WHERE id = 1'
        )
        .get() as unknown as {
        mcp_port: number
        theme: AppSettings['theme']
        http_concurrency: number
        browser_concurrency: number
      }
      return {
        mcpPort: Number(row.mcp_port),
        theme: row.theme,
        httpConcurrency: Number(row.http_concurrency),
        browserConcurrency: Number(row.browser_concurrency)
      }
    },
    saveSettings: (settings) => {
      validateSettings(settings)
      database
        .prepare(
          `UPDATE app_settings
           SET mcp_port = ?, theme = ?, http_concurrency = ?, browser_concurrency = ?
           WHERE id = 1`
        )
        .run(
          settings.mcpPort,
          settings.theme,
          settings.httpConcurrency,
          settings.browserConcurrency
        )
      return settings
    },
    close: () => database.close()
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
