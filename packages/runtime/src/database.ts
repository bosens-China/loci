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
  parseGithubRepositoryUrl
} from '@loci/core'
import { deleteDocumentsOutsideScope } from './database-source-scope.js'
import { migrateDatabase, validateSourceInput } from './database-values.js'
import { DEFAULT_APP_SETTINGS, normalizeServerUrl, type SourceKind } from '@loci/shared'
import { and, eq } from 'drizzle-orm'
import { createCloudLibraryDatabase } from './cloud-library-database.js'
import {
  createSettingsDatabase,
  initializeSettings,
  type SettingsInitializationOptions
} from './settings-database.js'
import { exportDatabaseBackup, importDatabaseBackup } from './database-backup.js'
import { createInteractionPreferencesDatabase } from './interaction-preferences.js'
import {
  createCrawlHistoryDatabase,
  initializeCrawlHistoryDatabase
} from './crawl-history-database.js'
import {
  createDocumentContentDatabase,
  deleteSourceDocuments
} from './document-content-database.js'
import { LOCI_DATABASE_SCHEMA, LOCI_SCHEMA_VERSION } from './database-schema.js'
import { createSkillInstallationDatabase } from './skill-database.js'
import { createLocalJobDatabase, initializeLocalJobDatabase } from './local-job-database.js'
import {
  createLocalJobEventDatabase,
  initializeLocalJobEventDatabase
} from './local-job-event-database.js'
import {
  assertLocalSourceIdentityAvailable,
  createWebSourceIdentity,
  findLocalSourceId,
  listDocumentSources,
  readDocumentSource,
  readSourceConfig,
  throwLocalHostnameConflict,
  updateResolvedSourceRecord,
  withTransaction
} from './database-local-source.js'
import {
  createExplicitPageDatabase,
  initializeExplicitPageDatabase
} from './explicit-page-database.js'
import { createUrlReviewDatabase, initializeUrlReviewDatabase } from './url-review-database.js'
import type { LociDatabase } from './database-types.js'
import { commitSourceCrawl } from './database-source-commit.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { documentSources } from './drizzle-schema.js'
import {
  createResourceRevisionDatabase,
  initializeResourceRevisionDatabase
} from './resource-revision-database.js'

export { LOCI_SCHEMA_VERSION } from './database-schema.js'
export { databaseNeedsMigration } from './database-lifecycle.js'

export type { SourceConfig } from './database-local-source.js'
export type { LociDatabase, SourceCrawlCommit } from './database-types.js'

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
    initializeResourceRevisionDatabase(database)
    initializeLocalJobEventDatabase(database)
    initializeExplicitPageDatabase(database)
    initializeUrlReviewDatabase(database)
    migrateDatabase(database, row.user_version)
    initializeSettings(database, options)
    database.exec(`PRAGMA user_version = ${LOCI_SCHEMA_VERSION}`)
  } catch (error) {
    database.close()
    throw error
  }

  const drizzleDatabase = createDrizzleDatabase(database)

  return {
    schemaVersion: LOCI_SCHEMA_VERSION,
    ...createCloudLibraryDatabase(database, drizzleDatabase),
    ...createSettingsDatabase(drizzleDatabase, serverUrlOverride),
    ...createInteractionPreferencesDatabase(drizzleDatabase),
    ...createCrawlHistoryDatabase(database, drizzleDatabase),
    ...createDocumentContentDatabase(database, drizzleDatabase),
    ...createSkillInstallationDatabase(drizzleDatabase),
    ...createLocalJobDatabase(database),
    ...createLocalJobEventDatabase(database),
    ...createResourceRevisionDatabase(drizzleDatabase),
    ...createExplicitPageDatabase(database, drizzleDatabase),
    ...createUrlReviewDatabase(database),
    listSources: () => listDocumentSources(drizzleDatabase),
    createSource: (input) => {
      const schedule = validateSourceInput(input)
      const repository = parseGithubRepositoryUrl(input.url)
      const kind = resolveSourceKind(input.kind, repository !== null)
      if (kind === 'github' && input.discoveryMode === 'agent_review') {
        throw new Error('Agent URL 审查模式暂不支持 GitHub 仓库')
      }
      const url = kind === 'github' ? repository!.url : normalizeUrl(input.url)
      const hostname = getHostname(url)
      const mode = kind === 'github' ? DOCUMENT_SOURCE_DEFAULTS.mode : input.mode
      const scopePath =
        kind === 'github'
          ? DOCUMENT_SOURCE_DEFAULTS.scopePath
          : normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
      const excludePathPattern =
        kind === 'github' ? null : normalizeExcludePathPattern(input.excludePathPattern)
      if (!isUrlInScope(url, hostname, scopePath)) throw new Error('起始页面不在收录范围内')
      if (isPathExcluded(url, excludePathPattern)) throw new Error('起始页面不能被排除路径正则命中')
      const identity =
        kind === 'github' ? repository!.identity : createWebSourceIdentity(hostname, scopePath)
      const existingId = findLocalSourceId(drizzleDatabase, identity)
      if (existingId) return readDocumentSource(drizzleDatabase, existingId)
      const now = new Date().toISOString()
      const id = randomUUID()
      try {
        drizzleDatabase
          .insert(documentSources)
          .values({
            id,
            name: input.name.trim(),
            firstUrl: url,
            hostname,
            fetchMode: mode,
            pageLimit: input.pageLimit,
            scopePath,
            excludePathPattern,
            schedule,
            httpConcurrency: input.httpConcurrency,
            browserConcurrency: input.browserConcurrency,
            documentKind: kind,
            sourceIdentity: identity,
            githubArchiveLimitMb: input.githubArchiveLimitMb ?? null,
            githubMarkdownLimitMb: input.githubMarkdownLimitMb ?? null,
            discoveryMode: input.discoveryMode ?? 'site',
            reviewGoal:
              input.discoveryMode === 'agent_review' ? (input.reviewGoal?.trim() ?? null) : null,
            sourceType: 'local',
            cloudAutoSync: 0,
            createdAt: now,
            updatedAt: now
          })
          .run()
      } catch (error) {
        const duplicateId = findLocalSourceId(drizzleDatabase, identity)
        if (duplicateId) return readDocumentSource(drizzleDatabase, duplicateId)
        throwLocalHostnameConflict(error)
      }
      return readDocumentSource(drizzleDatabase, id)
    },
    updateSource: (id, input) => {
      const schedule = validateSourceInput(input)
      const repository = parseGithubRepositoryUrl(input.url)
      const kind = resolveSourceKind(input.kind, repository !== null)
      const url = kind === 'github' ? repository!.url : normalizeUrl(input.url)
      const hostname = getHostname(url)
      const mode = kind === 'github' ? DOCUMENT_SOURCE_DEFAULTS.mode : input.mode
      const scopePath =
        kind === 'github'
          ? DOCUMENT_SOURCE_DEFAULTS.scopePath
          : normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
      const excludePathPattern =
        kind === 'github' ? null : normalizeExcludePathPattern(input.excludePathPattern)
      if (!isUrlInScope(url, hostname, scopePath)) {
        throw new Error('起始页面不在收录范围内')
      }
      if (isPathExcluded(url, excludePathPattern)) {
        throw new Error('起始页面不能被排除路径正则命中')
      }
      const identity =
        kind === 'github' ? repository!.identity : createWebSourceIdentity(hostname, scopePath)
      const current = drizzleDatabase
        .select({
          firstUrl: documentSources.firstUrl,
          pageLimit: documentSources.pageLimit,
          scopePath: documentSources.scopePath,
          excludePathPattern: documentSources.excludePathPattern,
          documentKind: documentSources.documentKind,
          githubArchiveLimitMb: documentSources.githubArchiveLimitMb,
          githubMarkdownLimitMb: documentSources.githubMarkdownLimitMb,
          discoveryMode: documentSources.discoveryMode,
          reviewGoal: documentSources.reviewGoal
        })
        .from(documentSources)
        .where(and(eq(documentSources.id, id), eq(documentSources.sourceType, 'local')))
        .get()
      if (!current) throw new Error('文档源不存在')
      const discoveryMode = input.discoveryMode ?? current.discoveryMode
      const requestedReviewGoal =
        input.reviewGoal === undefined ? current.reviewGoal : input.reviewGoal
      const reviewGoal = discoveryMode === 'agent_review' ? requestedReviewGoal : null
      if (kind === 'github' && discoveryMode === 'agent_review') {
        throw new Error('Agent URL 审查模式暂不支持 GitHub 仓库')
      }
      if (discoveryMode === 'agent_review' && !reviewGoal?.trim()) {
        throw new Error('Agent 审查模式需要说明收录目标')
      }
      const resetGithubState =
        current.firstUrl !== url ||
        current.pageLimit !== input.pageLimit ||
        current.githubArchiveLimitMb !== (input.githubArchiveLimitMb ?? null) ||
        current.githubMarkdownLimitMb !== (input.githubMarkdownLimitMb ?? null)
      const resetResolvedDiscovery =
        current.firstUrl !== url ||
        current.documentKind !== kind ||
        current.scopePath !== scopePath ||
        current.excludePathPattern !== excludePathPattern ||
        current.discoveryMode !== discoveryMode
      const clearDocuments =
        current.documentKind !== kind ||
        getHostname(current.firstUrl) !== hostname ||
        (kind === 'github' && current.firstUrl !== url)
      const updatedAt = new Date().toISOString()
      try {
        withTransaction(database, () => {
          assertLocalSourceIdentityAvailable(drizzleDatabase, identity, kind === 'github', id)
          const result = database
            .prepare(
              `UPDATE document_sources
               SET name = ?, first_url = ?, hostname = ?, fetch_mode = ?, page_limit = ?, scope_path = ?, exclude_path_pattern = ?,
                   schedule = ?, http_concurrency = ?, browser_concurrency = ?, document_kind = ?,
                   source_identity = ?, github_archive_limit_mb = ?, github_markdown_limit_mb = ?,
                   discovery_mode = ?, review_goal = ?,
                   resolved_discovery = CASE WHEN ? THEN NULL ELSE resolved_discovery END,
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
              kind,
              identity,
              input.githubArchiveLimitMb ?? null,
              input.githubMarkdownLimitMb ?? null,
              discoveryMode,
              reviewGoal?.trim() || null,
              resetResolvedDiscovery ? 1 : 0,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              resetGithubState ? 1 : 0,
              updatedAt,
              id
            )
          if (Number(result.changes) !== 1) throw new Error('文档源不存在')
          if (clearDocuments) {
            deleteSourceDocuments(database, id)
            database.prepare('DELETE FROM explicit_page_targets WHERE source_id = ?').run(id)
          } else if (kind === 'web') {
            deleteDocumentsOutsideScope(database, id, hostname, scopePath, excludePathPattern)
          } else {
            database.prepare('DELETE FROM explicit_page_targets WHERE source_id = ?').run(id)
          }
        })
      } catch (error) {
        throwLocalHostnameConflict(error)
      }
      return readDocumentSource(drizzleDatabase, id)
    },
    updateResolvedSource: (id, firstUrl, mode, iconUrl, github, discovery) =>
      updateResolvedSourceRecord(database, id, firstUrl, mode, iconUrl, github, discovery),
    commitSourceCrawl: (id, commit) => commitSourceCrawl(database, id, commit),
    updateGithubBlocked: (id, blocked) => {
      drizzleDatabase
        .update(documentSources)
        .set({
          githubBlockedRevision: blocked.revision,
          githubBlockedLimitKind: blocked.kind,
          githubBlockedLimitBytes: blocked.limitBytes,
          updatedAt: new Date().toISOString()
        })
        .where(and(eq(documentSources.id, id), eq(documentSources.sourceType, 'local')))
        .run()
    },
    getSourceConfig: (id) => readSourceConfig(drizzleDatabase, id),
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

function resolveSourceKind(kind: SourceKind | undefined, githubUrl: boolean): SourceKind {
  const inferred = githubUrl ? 'github' : 'web'
  if (!kind) return inferred
  if (kind === 'github' && !githubUrl) throw new Error('GitHub 文档源必须使用公开仓库首页 URL')
  if (kind === 'web' && githubUrl) throw new Error('普通站点不能使用 GitHub 仓库首页 URL')
  return kind
}
