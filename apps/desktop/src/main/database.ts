import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, isUrlInScope, normalizeScopePath, normalizeUrl } from './crawl/url'
import { deleteDocumentsOutsideScope } from './database-source-scope'
import {
  type DocumentRow,
  migrateDatabase,
  type SourceRow,
  toDocumentRecord,
  toDocumentSource,
  toFtsExpression,
  validateSourceInput
} from './database-values'
import type {
  CreateSourceInput,
  DocumentRecord,
  DocumentSource,
  UpdateSourceInput
} from '../shared/api'
import { DEFAULT_APP_SETTINGS } from '../shared/api'
import { createCloudLibraryDatabase, type CloudLibraryDatabase } from './cloud-library-database'
import { createSettingsDatabase, type SettingsDatabase } from './settings-database'
import {
  exportDatabaseBackup,
  importDatabaseBackup,
  type BackupImportSummary,
  type LociBackup
} from './database-backup'

export interface SourceConfig {
  id: string
  firstUrl: string
  hostname: string
  fetchMode: 'auto' | 'http' | 'browser'
  pageLimit: number
  scopePath: string
  httpConcurrency: number | null
  browserConcurrency: number | null
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

export interface CrawlHistoryRecord {
  id: string
  sourceId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  discovered: number
  succeeded: number
  failed: number
  error: string | null
}

export interface LociDatabase extends CloudLibraryDatabase, SettingsDatabase {
  schemaVersion: number
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
  clearDocuments: () => number
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  deleteSource: (id: string) => void
  startCrawlRun: (sourceId: string) => string
  finishCrawlRun: (
    id: string,
    status: 'completed' | 'failed',
    progress: { queued: number; succeeded: number; failed: number } | undefined,
    error: string | null
  ) => void
  listCrawlHistory: (sourceId?: string) => CrawlHistoryRecord[]
  exportBackup: () => LociBackup
  importBackup: (input: unknown) => BackupImportSummary
  close: () => void
}

export const LOCI_SCHEMA_VERSION = 1

export function databaseNeedsMigration(filename: string): boolean {
  if (filename === ':memory:' || !existsSync(filename)) return true
  const database = new DatabaseSync(filename, { readOnly: true })
  try {
    const row = database.prepare('PRAGMA user_version').get() as unknown as {
      user_version: number
    }
    return row.user_version < LOCI_SCHEMA_VERSION
  } finally {
    database.close()
  }
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
    scope_path TEXT NOT NULL DEFAULT '/',
    schedule TEXT,
    http_concurrency INTEGER CHECK (http_concurrency IS NULL OR http_concurrency BETWEEN 1 AND 32),
    browser_concurrency INTEGER CHECK (browser_concurrency IS NULL OR browser_concurrency BETWEEN 1 AND 32),
    icon_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'local' CHECK (source_type IN ('local', 'cloud')),
    cloud_server_url TEXT,
    cloud_library_id TEXT,
    cloud_revision TEXT,
    cloud_auto_sync INTEGER NOT NULL DEFAULT 0 CHECK (cloud_auto_sync IN (0, 1)),
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
    browser_concurrency INTEGER NOT NULL DEFAULT 2 CHECK (browser_concurrency BETWEEN 1 AND 32),
    server_url TEXT NOT NULL DEFAULT 'http://localhost:7001'
  ) STRICT;

  INSERT OR IGNORE INTO app_settings (id, mcp_port, theme)
  VALUES (1, ${DEFAULT_APP_SETTINGS.mcpPort}, '${DEFAULT_APP_SETTINGS.theme}');
`

export function createDatabase(filename: string): LociDatabase {
  const database = new DatabaseSync(filename, {
    timeout: 5000,
    enableForeignKeyConstraints: true
  })
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    const row = database.prepare('PRAGMA user_version').get() as unknown as {
      user_version: number
    }
    if (row.user_version > LOCI_SCHEMA_VERSION) {
      throw new Error(
        `数据库版本 ${row.user_version} 高于当前支持的 ${LOCI_SCHEMA_VERSION}，请升级 Loci 后重试`
      )
    }
    database.exec(schema)
    migrateDatabase(database)
    database.exec(`PRAGMA user_version = ${LOCI_SCHEMA_VERSION}`)
  } catch (error) {
    database.close()
    throw error
  }

  return {
    schemaVersion: LOCI_SCHEMA_VERSION,
    ...createCloudLibraryDatabase(database),
    ...createSettingsDatabase(database),
    listSources: () => {
      const rows = database
        .prepare(
          `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.scope_path, s.schedule,
             s.http_concurrency, s.browser_concurrency, s.icon_url, s.source_type,
             s.cloud_server_url, s.cloud_library_id, s.cloud_revision, s.cloud_auto_sync,
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
      const scopePath = normalizeScopePath(input.scopePath ?? '/')
      if (!isUrlInScope(url, hostname, scopePath)) throw new Error('起始页面不在收录范围内')
      const existing = database
        .prepare("SELECT id FROM document_sources WHERE hostname = ? AND source_type = 'local'")
        .get(hostname)
      if (existing) throw new Error('这个域名已经存在于文档源中')
      const now = new Date().toISOString()
      const id = randomUUID()
      database
        .prepare(
          `INSERT INTO document_sources
           (id, name, first_url, hostname, fetch_mode, page_limit, scope_path, schedule, http_concurrency, browser_concurrency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.name.trim(),
          url,
          hostname,
          input.mode,
          input.pageLimit,
          scopePath,
          schedule,
          input.httpConcurrency,
          input.browserConcurrency,
          now,
          now
        )
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, scope_path, schedule, http_concurrency, browser_concurrency, icon_url,
             source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
             0 AS page_count, NULL AS last_crawled_at
         FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateSource: (id, input) => {
      const schedule = validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const scopePath = normalizeScopePath(input.scopePath ?? '/')
      if (!isUrlInScope(url, getHostname(url), scopePath)) {
        throw new Error('起始页面不在收录范围内')
      }
      const updatedAt = new Date().toISOString()
      const result = database
        .prepare(
          `UPDATE document_sources
           SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, scope_path = ?, schedule = ?, http_concurrency = ?, browser_concurrency = ?, updated_at = ?
           WHERE id = ? AND source_type = 'local'`
        )
        .run(
          input.name.trim(),
          url,
          getHostname(url),
          input.mode,
          input.pageLimit,
          scopePath,
          schedule,
          input.httpConcurrency,
          input.browserConcurrency,
          updatedAt,
          id
        )
      if (Number(result.changes) !== 1) throw new Error('文档源不存在')
      deleteDocumentsOutsideScope(database, id, getHostname(url), scopePath)
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, scope_path, schedule, http_concurrency, browser_concurrency, icon_url,
             source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
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
          `SELECT id, first_url, hostname, fetch_mode, page_limit, scope_path, http_concurrency, browser_concurrency, source_type
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as
        | {
            id: string
            first_url: string
            hostname: string
            fetch_mode: SourceConfig['fetchMode']
            page_limit: number
            scope_path: string
            http_concurrency: number | null
            browser_concurrency: number | null
            source_type: 'local' | 'cloud'
          }
        | undefined
      if (!source) throw new Error('文档源不存在')
      if (source.source_type !== 'local') throw new Error('云文档只能从来源服务器更新')
      return {
        id: source.id,
        firstUrl: source.first_url,
        hostname: source.hostname,
        fetchMode: source.fetch_mode,
        pageLimit: Number(source.page_limit),
        scopePath: source.scope_path,
        httpConcurrency: source.http_concurrency === null ? null : Number(source.http_concurrency),
        browserConcurrency:
          source.browser_concurrency === null ? null : Number(source.browser_concurrency)
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
    clearDocuments: () =>
      withTransaction(database, () => {
        database.exec('DELETE FROM documents_fts')
        return Number(database.prepare('DELETE FROM documents').run().changes)
      }),
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
    },
    listCrawlHistory: (sourceId) => {
      const rows = (sourceId
        ? database
            .prepare(
              `SELECT id, source_id, status, started_at, finished_at, discovered_count,
                 success_count, failure_count, error_message
               FROM crawl_runs WHERE source_id = ? ORDER BY started_at DESC LIMIT 50`
            )
            .all(sourceId)
        : database
            .prepare(
              `SELECT id, source_id, status, started_at, finished_at, discovered_count,
                 success_count, failure_count, error_message
               FROM crawl_runs ORDER BY started_at DESC LIMIT 50`
            )
            .all()) as unknown as Array<{
        id: string
        source_id: string
        status: CrawlHistoryRecord['status']
        started_at: string | null
        finished_at: string | null
        discovered_count: number
        success_count: number
        failure_count: number
        error_message: string | null
      }>
      return rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        discovered: Number(row.discovered_count),
        succeeded: Number(row.success_count),
        failed: Number(row.failure_count),
        error: row.error_message
      }))
    },
    deleteSource: (id) => {
      withTransaction(database, () => {
        database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(id)
        database.prepare('DELETE FROM document_sources WHERE id = ?').run(id)
      })
    },
    exportBackup: () => exportDatabaseBackup(database),
    importBackup: (input) => importDatabaseBackup(database, input),
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
