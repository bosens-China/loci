import { DatabaseSync } from 'node:sqlite'
import { and, eq } from 'drizzle-orm'
import { createSettingsDatabase, initializeSettings } from './settings-database.js'
import {
  exportDatabaseBackup,
  importDatabaseBackup,
  restoreDatabaseBackup
} from './database-backup.js'
import { createBackupArchive, parseBackupArchive } from './database-backup-archive.js'
import { createInteractionPreferencesDatabase } from './interaction-preferences.js'
import { createHostnameCrawlPolicyDatabase } from './hostname-crawl-policy-database.js'
import {
  createCrawlHistoryDatabase,
  initializeCrawlHistoryDatabase
} from './crawl-history-database.js'
import { createDocumentContentDatabase } from './document-content-database.js'
import { createClearDataDatabase } from './clear-data-database.js'
import { createMutationDatabase } from './document-mutation.js'
import {
  LOCI_DATABASE_SCHEMA,
  LOCI_SCHEMA_VERSION,
  ADDITIVE_SCHEMA_EXTENSIONS
} from './database-schema.js'
import {
  createSkillInstallationDatabase,
  migrateSkillInstallationsForPi
} from './skill-database.js'
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
import type { LociDatabase } from './database-types.js'
import { commitSourceCrawl, writeCrawlDocuments } from './database-source-commit.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { moveDocumentsToNewSource } from './document-move-database.js'
import { backupImportReceipts, documentSources } from './drizzle-schema.js'
import { createCategoryDatabase, seedCategories } from './category-database.js'
import {
  createLocalSourceMutationDatabase,
  createSourceInTransaction
} from './local-source-mutation-database.js'
import { migrateDatabase } from './database-values.js'
import { withImmediateTransaction, withTransaction } from './sqlite.js'

export { LOCI_SCHEMA_VERSION } from './database-schema.js'
export { databaseNeedsMigration } from './database-lifecycle.js'
export type { SourceConfig } from './database-local-source.js'
export type { LociDatabase, SourceCrawlCommit } from './database-types.js'

/** 同一连接上的全部迁移原子提交，并保留旧版数据库中的附加表。 */
export function createDatabase(filename: string): LociDatabase {
  const database = new DatabaseSync(filename, { timeout: 5000, enableForeignKeyConstraints: true })
  const drizzle = createDrizzleDatabase(database)
  try {
    // 迁移期间 SQLite 才允许在非空表追加带非空默认值的外键列。
    database.exec(
      'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;'
    )
    withImmediateTransaction(database, () => {
      const version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
      if (version > LOCI_SCHEMA_VERSION)
        throw new Error(
          `数据库版本 ${version} 高于当前支持的 ${LOCI_SCHEMA_VERSION}，请升级 Loci 后重试`
        )
      if (version < LOCI_SCHEMA_VERSION) {
        if (version < 23) migrateSkillInstallationsForPi(database)
        if (version < 22) {
          database.exec(LOCI_DATABASE_SCHEMA)
          initializeCrawlHistoryDatabase(database)
          initializeExplicitPageDatabase(database)
          migrateDatabase(database, version)
          seedCategories(drizzle)
          initializeSettings(drizzle)
        }
        if (database.prepare('PRAGMA foreign_key_check').get())
          throw new Error('迁移后存在无效的外键引用')
        database.exec(`PRAGMA user_version = ${LOCI_SCHEMA_VERSION}`)
      }
      database.exec(ADDITIVE_SCHEMA_EXTENSIONS)
    })
    database.exec('PRAGMA foreign_keys = ON')
  } catch (error) {
    database.close()
    throw error
  }
  const settings = createSettingsDatabase(drizzle)
  const policies = createHostnameCrawlPolicyDatabase(drizzle)
  const sources = createLocalSourceMutationDatabase(database, drizzle)
  const clear = createClearDataDatabase(database, drizzle)
  return {
    schemaVersion: LOCI_SCHEMA_VERSION,
    ...settings,
    ...policies,
    patchAppSettings: (partial) =>
      withImmediateTransaction(database, () =>
        settings.saveSettings({ ...settings.getSettings(), ...partial })
      ),
    patchHostnamePolicy: (hostname, partial) =>
      withImmediateTransaction(database, () =>
        policies.saveHostnameCrawlPolicy({
          httpConcurrency: null,
          browserConcurrency: null,
          batchIntervalMinSeconds: null,
          batchIntervalMaxSeconds: null,
          ...policies.getHostnameCrawlPolicy(hostname),
          ...partial,
          hostname
        })
      ),
    ...createInteractionPreferencesDatabase(drizzle),
    ...createCrawlHistoryDatabase(database, drizzle),
    ...createMutationDatabase(database, drizzle),
    ...createDocumentContentDatabase(database, drizzle),
    ...clear,
    clearDocuments: () => clear.clearData('documents').documents,
    clearSources: () => clear.clearData('sources').libraries,
    ...createSkillInstallationDatabase(drizzle),
    ...createExplicitPageDatabase(database, drizzle),
    ...createCategoryDatabase(database, drizzle),
    ...sources,
    hasSource: (id) =>
      Boolean(
        drizzle
          .select({ id: documentSources.id })
          .from(documentSources)
          .where(eq(documentSources.id, id))
          .get()
      ),
    readSnapshot: (read) => withTransaction(database, read),
    getSource: (id) => readDocumentSource(drizzle, id),
    listSources: (filters) => listDocumentSources(drizzle, filters),
    updateResolvedSource: (id, firstUrl, mode, iconUrl, github, discovery) =>
      updateResolvedSourceRecord(database, id, firstUrl, mode, iconUrl, github, discovery),
    replaceSourceDocuments: (id, documents) =>
      withImmediateTransaction(database, () => {
        writeCrawlDocuments(database, id, { documents, deletedUrls: [], replaceAll: true })
      }),
    commitSourceCrawl: (id, commit) => commitSourceCrawl(database, id, commit),
    updateGithubBlocked: (id, blocked) => {
      drizzle
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
    getSourceConfig: (id) => readSourceConfig(drizzle, id),
    exportBackup: (options) =>
      withTransaction(database, () => exportDatabaseBackup(database, options)),
    importBackup: (input, options) => importDatabaseBackup(database, input, options),
    exportBackupArchive: (options) =>
      createBackupArchive(
        withTransaction(database, () => exportDatabaseBackup(database, options)),
        LOCI_SCHEMA_VERSION
      ),
    getBackupImportSummary: (id) =>
      drizzle
        .select({ summary: backupImportReceipts.summary })
        .from(backupImportReceipts)
        .where(eq(backupImportReceipts.operationId, id))
        .get()?.summary,
    importBackupArchive: async (input, options, operationId) =>
      restoreDatabaseBackup(
        database,
        (await parseBackupArchive(input)).backup,
        options,
        operationId
      ),
    moveDocumentsToNewSource: (input) =>
      moveDocumentsToNewSource(
        database,
        drizzle,
        input,
        (source) => createSourceInTransaction(database, drizzle, source),
        (id) => readDocumentSource(drizzle, id)
      ),
    close: () => database.close()
  }
}
