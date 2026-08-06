import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, isUrlInScope, normalizeScopePath, normalizeUrl } from '@loci/core'
import { deleteDocumentsOutsideScope } from './database-source-scope.js'
import {
  migrateDatabase,
  type SourceRow,
  toDocumentSource,
  validateSourceInput
} from './database-values.js'
import type { CreateSourceInput, DocumentSource, UpdateSourceInput } from '@loci/shared'
import { DEFAULT_APP_SETTINGS, normalizeServerUrl } from '@loci/shared'
import { createCloudLibraryDatabase, type CloudLibraryDatabase } from './cloud-library-database.js'
import {
  createSettingsDatabase,
  initializeSettings,
  type SettingsDatabase,
  type SettingsInitializationOptions
} from './settings-database.js'
import {
  exportDatabaseBackup,
  importDatabaseBackup,
  type BackupImportSummary,
  type LociBackup
} from './database-backup.js'
import {
  createInteractionPreferencesDatabase,
  type InteractionPreferencesDatabase
} from './interaction-preferences.js'
import {
  createCrawlHistoryDatabase,
  type CrawlHistoryDatabase,
  initializeCrawlHistoryDatabase
} from './crawl-history-database.js'
import {
  createDocumentContentDatabase,
  type DocumentContentDatabase
} from './document-content-database.js'
import { LOCI_DATABASE_SCHEMA, LOCI_SCHEMA_VERSION } from './database-schema.js'

export { LOCI_SCHEMA_VERSION } from './database-schema.js'

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

export interface LociDatabase
  extends
    CloudLibraryDatabase,
    SettingsDatabase,
    InteractionPreferencesDatabase,
    CrawlHistoryDatabase,
    DocumentContentDatabase {
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
  deleteSource: (id: string) => void
  exportBackup: () => LociBackup
  importBackup: (input: unknown) => BackupImportSummary
  close: () => void
}

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

export type CreateDatabaseOptions = SettingsInitializationOptions

export function createDatabase(
  filename: string,
  options: CreateDatabaseOptions = {}
): LociDatabase {
  const serverUrlOverride = options.overrideServerUrl
    ? normalizeServerUrl(options.serverUrl ?? DEFAULT_APP_SETTINGS.serverUrl)
    : undefined
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
    database.exec(LOCI_DATABASE_SCHEMA)
    initializeCrawlHistoryDatabase(database)
    migrateDatabase(database)
    initializeSettings(database, options)
    database.exec(`PRAGMA user_version = ${LOCI_SCHEMA_VERSION}`)
  } catch (error) {
    database.close()
    throw error
  }

  return {
    schemaVersion: LOCI_SCHEMA_VERSION,
    ...createCloudLibraryDatabase(database),
    ...createSettingsDatabase(database, serverUrlOverride),
    ...createInteractionPreferencesDatabase(database),
    ...createCrawlHistoryDatabase(database),
    ...createDocumentContentDatabase(database),
    listSources: () => {
      const rows = database
        .prepare(
          `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.scope_path, s.schedule,
             s.http_concurrency, s.browser_concurrency, s.icon_url, s.source_type,
             s.cloud_server_url, s.cloud_library_id, s.cloud_revision, s.cloud_auto_sync,
             COUNT(d.id) AS page_count,
             COALESCE(SUM(length(CAST(d.markdown AS BLOB))), 0) AS content_size,
             MAX(d.crawled_at) AS last_crawled_at
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
      assertLocalHostnameAvailable(database, hostname)
      const now = new Date().toISOString()
      const id = randomUUID()
      try {
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
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, scope_path, schedule, http_concurrency, browser_concurrency, icon_url,
             source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
             0 AS page_count, 0 AS content_size, NULL AS last_crawled_at
         FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateSource: (id, input) => {
      const schedule = validateSourceInput(input)
      const url = normalizeUrl(input.url)
      const hostname = getHostname(url)
      const scopePath = normalizeScopePath(input.scopePath ?? '/')
      if (!isUrlInScope(url, hostname, scopePath)) {
        throw new Error('起始页面不在收录范围内')
      }
      const updatedAt = new Date().toISOString()
      try {
        withTransaction(database, () => {
          assertLocalHostnameAvailable(database, hostname, id)
          const result = database
            .prepare(
              `UPDATE document_sources
               SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, scope_path = ?, schedule = ?, http_concurrency = ?, browser_concurrency = ?, updated_at = ?
               WHERE id = ? AND source_type = 'local'`
            )
            .run(
              input.name.trim(),
              url,
              hostname,
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
          deleteDocumentsOutsideScope(database, id, hostname, scopePath)
        })
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, scope_path, schedule, http_concurrency, browser_concurrency, icon_url,
             source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
             (SELECT COUNT(*) FROM documents WHERE source_id = document_sources.id) AS page_count,
             (SELECT COALESCE(SUM(length(CAST(markdown AS BLOB))), 0) FROM documents WHERE source_id = document_sources.id) AS content_size,
             (SELECT MAX(crawled_at) FROM documents WHERE source_id = document_sources.id) AS last_crawled_at
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateResolvedSource: (id, firstUrl, mode, iconUrl) => {
      const url = normalizeUrl(firstUrl)
      try {
        database
          .prepare(
            `UPDATE document_sources
             SET first_url = ?, hostname = ?, fetch_mode = ?, icon_url = COALESCE(?, icon_url), updated_at = ?
             WHERE id = ?`
          )
          .run(url, getHostname(url), mode, iconUrl, new Date().toISOString(), id)
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
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

function assertLocalHostnameAvailable(
  database: DatabaseSync,
  hostname: string,
  excludedId?: string
): void {
  const duplicate = excludedId
    ? database
        .prepare(
          "SELECT 1 FROM document_sources WHERE hostname = ? AND source_type = 'local' AND id <> ?"
        )
        .get(hostname, excludedId)
    : database
        .prepare("SELECT 1 FROM document_sources WHERE hostname = ? AND source_type = 'local'")
        .get(hostname)
  if (duplicate) throw new Error('这个域名已经存在于文档源中')
}

function throwLocalHostnameConflict(error: unknown): never {
  if (
    error instanceof Error &&
    (error.message.includes('document_sources_local_hostname') ||
      error.message.includes('UNIQUE constraint failed: document_sources.hostname'))
  ) {
    throw new Error('这个域名已经存在于文档源中')
  }
  throw error
}
