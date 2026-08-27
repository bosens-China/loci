import { DatabaseSync } from 'node:sqlite'
import { createLibraryPublishArchive } from '@loci/core'
import { migrateDatabase } from './database-values.js'
import { DEFAULT_APP_SETTINGS, normalizeServerUrl } from '@loci/shared'
import { and, eq } from 'drizzle-orm'
import { createCloudLibraryDatabase } from './cloud-library-database.js'
import {
  createSettingsDatabase,
  initializeSettings,
  type SettingsInitializationOptions
} from './settings-database.js'
import { exportDatabaseBackup, importDatabaseBackup } from './database-backup.js'
import { createBackupArchive, parseBackupArchive } from './database-backup-archive.js'
import { createInteractionPreferencesDatabase } from './interaction-preferences.js'
import { createHostnameCrawlPolicyDatabase } from './hostname-crawl-policy-database.js'
import {
  createCrawlHistoryDatabase,
  initializeCrawlHistoryDatabase
} from './crawl-history-database.js'
import { createDocumentContentDatabase } from './document-content-database.js'
import { LOCI_DATABASE_SCHEMA, LOCI_SCHEMA_VERSION } from './database-schema.js'
import { createSkillInstallationDatabase } from './skill-database.js'
import { createLocalJobDatabase, initializeLocalJobDatabase } from './local-job-database.js'
import { createLoggedLocalJobDatabase } from './logged-local-job-database.js'
import {
  createLocalJobEventDatabase,
  initializeLocalJobEventDatabase
} from './local-job-event-database.js'
import {
  listDocumentSources,
  readDocumentSource,
  readSourceConfig,
  updateResolvedSourceRecord
} from './database-local-source.js'
import {
  createExplicitPageDatabase,
  initializeExplicitPageDatabase
} from './explicit-page-database.js'
import { createUrlReviewDatabase, initializeUrlReviewDatabase } from './url-review-database.js'
import type { LociDatabase } from './database-types.js'
import { commitSourceCrawl } from './database-source-commit.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { createOperationLogDatabase } from './operation-log-database.js'
import { moveDocumentsToNewSource } from './document-move-database.js'
import {
  createLoggedHostnamePolicyDatabase,
  createLoggedSettingsDatabase
} from './logged-settings-database.js'
import { documentSources } from './drizzle-schema.js'
import { createLocalSourceMutationDatabase } from './local-source-mutation-database.js'
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
  const operationLogs = createOperationLogDatabase(drizzleDatabase)
  const localJobs = createLoggedLocalJobDatabase(createLocalJobDatabase(database), operationLogs)
  const documentContent = createDocumentContentDatabase(database, drizzleDatabase)
  const settings = createLoggedSettingsDatabase(
    createSettingsDatabase(drizzleDatabase, serverUrlOverride),
    operationLogs
  )
  const hostnamePolicies = createLoggedHostnamePolicyDatabase(
    createHostnameCrawlPolicyDatabase(drizzleDatabase),
    operationLogs
  )
  const sourceMutations = createLocalSourceMutationDatabase(
    database,
    drizzleDatabase,
    operationLogs
  )

  const lociDatabase: LociDatabase = {
    schemaVersion: LOCI_SCHEMA_VERSION,
    ...createCloudLibraryDatabase(database, drizzleDatabase),
    ...settings,
    ...createInteractionPreferencesDatabase(drizzleDatabase),
    ...hostnamePolicies,
    ...createCrawlHistoryDatabase(database, drizzleDatabase),
    ...documentContent,
    ...createSkillInstallationDatabase(drizzleDatabase),
    ...localJobs,
    ...createLocalJobEventDatabase(database),
    ...operationLogs,
    ...createResourceRevisionDatabase(drizzleDatabase),
    ...createExplicitPageDatabase(database, drizzleDatabase),
    ...createUrlReviewDatabase(database),
    listSources: () => listDocumentSources(drizzleDatabase),
    ...sourceMutations,
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
    exportBackup: () => exportDatabaseBackup(database),
    importBackup: (input) => importDatabaseBackup(database, input),
    exportBackupArchive: async () => {
      const archive = await createBackupArchive(exportDatabaseBackup(database), LOCI_SCHEMA_VERSION)
      operationLogs.recordOperationLog({
        category: 'maintenance',
        action: 'backup.export',
        level: 'info',
        message: '已导出 ZIP 备份',
        details: { bytes: archive.length }
      })
      return archive
    },
    importBackupArchive: async (input) => {
      const summary = importDatabaseBackup(database, (await parseBackupArchive(input)).backup)
      operationLogs.recordOperationLog({
        category: 'maintenance',
        action: 'backup.import',
        level: 'warning',
        message: '已从 ZIP 备份恢复数据',
        details: { sources: summary.sources, documents: summary.documents }
      })
      return summary
    },
    exportLibraryPublishArchive: async (sourceId, mode, targetLibraryId) => {
      const source = readDocumentSource(drizzleDatabase, sourceId)
      if (source.cloud) throw new Error('只能发布本地文档库')
      const documents = documentContent
        .listDocuments()
        .filter((item) => item.sourceId === sourceId)
        .map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          language: item.language,
          markdown: item.content,
          crawledAt: item.updatedAt,
          relativePath: new URL(item.url).pathname
        }))
      if (!documents.length) throw new Error('文档库没有可发布内容')
      return createLibraryPublishArchive({
        mode,
        targetLibraryId: mode === 'replace' ? (targetLibraryId ?? null) : null,
        source: {
          name: source.name,
          url: source.url,
          scopePath: source.scopePath,
          pageLimit: source.pageLimit
        },
        documents
      })
    },
    moveDocumentsToNewSource: (input) =>
      moveDocumentsToNewSource(
        database,
        drizzleDatabase,
        input,
        lociDatabase.createSource,
        (id) => readDocumentSource(drizzleDatabase, id),
        operationLogs
      ),
    close: () => database.close()
  }
  return lociDatabase
}
