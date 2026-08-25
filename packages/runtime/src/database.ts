import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  getHostname,
  isPathExcluded,
  isUrlInScope,
  normalizeExcludePathPattern,
  normalizeScopePath,
  normalizeUrl,
  parseGithubRepositoryUrl,
  type ExplicitPageResult,
  type GithubBlockedState
} from '@loci/core'
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
  deleteStoredDocument,
  storeDocument,
  type DocumentContentDatabase,
  type StoredDocument
} from './document-content-database.js'
import { LOCI_DATABASE_SCHEMA, LOCI_SCHEMA_VERSION } from './database-schema.js'
import {
  createSkillInstallationDatabase,
  type SkillInstallationDatabase
} from './skill-database.js'
import {
  createLocalJobDatabase,
  initializeLocalJobDatabase,
  type LocalJobDatabase
} from './local-job-database.js'
import {
  assertLocalSourceIdentityAvailable,
  createWebSourceIdentity,
  findLocalSourceId,
  readDocumentSource,
  readSourceConfig,
  throwLocalHostnameConflict,
  updateResolvedSourceRecord,
  withTransaction,
  type SourceConfig
} from './database-local-source.js'
import {
  commitExplicitPageResults,
  createExplicitPageDatabase,
  initializeExplicitPageDatabase,
  type ExplicitPageDatabase
} from './explicit-page-database.js'

export { LOCI_SCHEMA_VERSION } from './database-schema.js'
export { databaseNeedsMigration } from './database-lifecycle.js'

export type { SourceConfig } from './database-local-source.js'

export interface SourceCrawlCommit {
  documents: StoredDocument[]
  deletedUrls: string[]
  replaceAll: boolean
  explicitPages?: readonly ExplicitPageResult[]
  resolution: {
    firstUrl: string
    mode: 'http' | 'browser'
    iconUrl: string | null
    github?: { defaultBranch: string; revision: string }
  }
}

export interface LociDatabase
  extends
    CloudLibraryDatabase,
    SettingsDatabase,
    InteractionPreferencesDatabase,
    CrawlHistoryDatabase,
    DocumentContentDatabase,
    SkillInstallationDatabase,
    LocalJobDatabase,
    ExplicitPageDatabase {
  schemaVersion: number
  listSources: () => DocumentSource[]
  createSource: (input: CreateSourceInput) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  updateResolvedSource: (
    id: string,
    firstUrl: string,
    mode: 'http' | 'browser',
    iconUrl: string | null,
    github?: { defaultBranch: string; revision: string }
  ) => void
  commitSourceCrawl: (id: string, commit: SourceCrawlCommit) => void
  updateGithubBlocked: (id: string, blocked: GithubBlockedState) => void
  getSourceConfig: (id: string) => SourceConfig
  deleteSource: (id: string) => void
  exportBackup: () => LociBackup
  importBackup: (input: unknown) => BackupImportSummary
  close: () => void
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
    initializeLocalJobDatabase(database)
    initializeExplicitPageDatabase(database)
    migrateDatabase(database, row.user_version)
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
    ...createSkillInstallationDatabase(database),
    ...createLocalJobDatabase(database),
    ...createExplicitPageDatabase(database),
    listSources: () => {
      const rows = database
        .prepare(
          `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.scope_path, s.exclude_path_pattern, s.schedule,
             s.http_concurrency, s.browser_concurrency, s.icon_url, s.source_type,
             s.cloud_server_url, s.cloud_library_id, s.cloud_revision, s.cloud_auto_sync,
             s.document_kind, s.github_archive_limit_mb, s.github_markdown_limit_mb,
             s.github_default_branch, s.github_revision,
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
      const repository = parseGithubRepositoryUrl(input.url)
      const url = repository?.url ?? normalizeUrl(input.url)
      const hostname = getHostname(url)
      const mode = repository ? DOCUMENT_SOURCE_DEFAULTS.mode : input.mode
      const scopePath = repository
        ? DOCUMENT_SOURCE_DEFAULTS.scopePath
        : normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
      const excludePathPattern = repository
        ? null
        : normalizeExcludePathPattern(input.excludePathPattern)
      if (!isUrlInScope(url, hostname, scopePath)) throw new Error('起始页面不在收录范围内')
      if (isPathExcluded(url, excludePathPattern)) throw new Error('起始页面不能被排除路径正则命中')
      const identity = repository?.identity ?? createWebSourceIdentity(hostname, scopePath)
      const existingId = findLocalSourceId(database, identity)
      if (existingId) return readDocumentSource(database, existingId)
      const now = new Date().toISOString()
      const id = randomUUID()
      try {
        database
          .prepare(
            `INSERT INTO document_sources
             (id, name, first_url, hostname, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule,
              http_concurrency, browser_concurrency, document_kind, source_identity,
              github_archive_limit_mb, github_markdown_limit_mb, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            input.name.trim(),
            url,
            hostname,
            mode,
            input.pageLimit,
            scopePath,
            excludePathPattern,
            schedule,
            input.httpConcurrency,
            input.browserConcurrency,
            repository ? 'github' : 'web',
            identity,
            input.githubArchiveLimitMb ?? null,
            input.githubMarkdownLimitMb ?? null,
            now,
            now
          )
      } catch (error) {
        const duplicateId = findLocalSourceId(database, identity)
        if (duplicateId) return readDocumentSource(database, duplicateId)
        throwLocalHostnameConflict(error)
      }
      return readDocumentSource(database, id)
    },
    updateSource: (id, input) => {
      const schedule = validateSourceInput(input)
      const repository = parseGithubRepositoryUrl(input.url)
      const url = repository?.url ?? normalizeUrl(input.url)
      const hostname = getHostname(url)
      const mode = repository ? DOCUMENT_SOURCE_DEFAULTS.mode : input.mode
      const scopePath = repository
        ? DOCUMENT_SOURCE_DEFAULTS.scopePath
        : normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
      const excludePathPattern = repository
        ? null
        : normalizeExcludePathPattern(input.excludePathPattern)
      if (!isUrlInScope(url, hostname, scopePath)) {
        throw new Error('起始页面不在收录范围内')
      }
      if (isPathExcluded(url, excludePathPattern)) {
        throw new Error('起始页面不能被排除路径正则命中')
      }
      const identity = repository?.identity ?? createWebSourceIdentity(hostname, scopePath)
      const current = database
        .prepare(
          `SELECT first_url, page_limit, github_archive_limit_mb, github_markdown_limit_mb
           FROM document_sources WHERE id = ? AND source_type = 'local'`
        )
        .get(id) as unknown as
        | {
            first_url: string
            page_limit: number
            github_archive_limit_mb: number | null
            github_markdown_limit_mb: number | null
          }
        | undefined
      if (!current) throw new Error('文档源不存在')
      const resetGithubState =
        current.first_url !== url ||
        Number(current.page_limit) !== input.pageLimit ||
        current.github_archive_limit_mb !== (input.githubArchiveLimitMb ?? null) ||
        current.github_markdown_limit_mb !== (input.githubMarkdownLimitMb ?? null)
      const updatedAt = new Date().toISOString()
      try {
        withTransaction(database, () => {
          assertLocalSourceIdentityAvailable(database, identity, repository !== null, id)
          const result = database
            .prepare(
              `UPDATE document_sources
               SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, scope_path = ?, exclude_path_pattern = ?,
                   schedule = ?, http_concurrency = ?, browser_concurrency = ?, document_kind = ?,
                   source_identity = ?, github_archive_limit_mb = ?, github_markdown_limit_mb = ?,
                   github_revision = CASE WHEN ? THEN NULL ELSE github_revision END,
                   github_blocked_revision = CASE WHEN ? THEN NULL ELSE github_blocked_revision END,
                   github_blocked_limit_kind = CASE WHEN ? THEN NULL ELSE github_blocked_limit_kind END,
                   github_blocked_limit_bytes = CASE WHEN ? THEN NULL ELSE github_blocked_limit_bytes END,
                   updated_at = ?
               WHERE id = ? AND source_type = 'local'`
            )
            .run(
              input.name.trim(),
              url,
              hostname,
              mode,
              input.pageLimit,
              scopePath,
              excludePathPattern,
              schedule,
              input.httpConcurrency,
              input.browserConcurrency,
              repository ? 'github' : 'web',
              identity,
              input.githubArchiveLimitMb ?? null,
              input.githubMarkdownLimitMb ?? null,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              updatedAt,
              id
            )
          if (Number(result.changes) !== 1) throw new Error('文档源不存在')
          if (!repository) {
            deleteDocumentsOutsideScope(database, id, hostname, scopePath, excludePathPattern)
          } else {
            database.prepare('DELETE FROM explicit_page_targets WHERE source_id = ?').run(id)
          }
        })
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
      const source = database
        .prepare(
          `SELECT id, name, first_url, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule, http_concurrency, browser_concurrency, icon_url,
             source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
             document_kind, github_archive_limit_mb, github_markdown_limit_mb,
             github_default_branch, github_revision,
             (SELECT COUNT(*) FROM documents WHERE source_id = document_sources.id) AS page_count,
             (SELECT COALESCE(SUM(length(CAST(markdown AS BLOB))), 0) FROM documents WHERE source_id = document_sources.id) AS content_size,
             (SELECT MAX(crawled_at) FROM documents WHERE source_id = document_sources.id) AS last_crawled_at
           FROM document_sources WHERE id = ?`
        )
        .get(id) as unknown as SourceRow
      return toDocumentSource(source)
    },
    updateResolvedSource: (id, firstUrl, mode, iconUrl, github) =>
      updateResolvedSourceRecord(database, id, firstUrl, mode, iconUrl, github),
    commitSourceCrawl: (id, commit) => {
      try {
        withTransaction(database, () => {
          if (commit.replaceAll) {
            database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(id)
            database.prepare('DELETE FROM documents WHERE source_id = ?').run(id)
          } else {
            for (const url of new Set(commit.deletedUrls)) deleteStoredDocument(database, id, url)
          }
          for (const document of commit.documents) storeDocument(database, document)
          if (commit.explicitPages?.length) {
            commitExplicitPageResults(database, id, commit.explicitPages, commit.resolution.mode)
          }
          updateResolvedSourceRecord(
            database,
            id,
            commit.resolution.firstUrl,
            commit.resolution.mode,
            commit.resolution.iconUrl,
            commit.resolution.github
          )
        })
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
    },
    updateGithubBlocked: (id, blocked) => {
      database
        .prepare(
          `UPDATE document_sources
           SET github_blocked_revision = ?, github_blocked_limit_kind = ?,
               github_blocked_limit_bytes = ?, updated_at = ?
           WHERE id = ? AND source_type = 'local'`
        )
        .run(blocked.revision, blocked.kind, blocked.limitBytes, new Date().toISOString(), id)
    },
    getSourceConfig: (id) => readSourceConfig(database, id),
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
