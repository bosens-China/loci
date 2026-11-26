import type { CrawlProgress, ExplicitPageResult } from '@loci/core'
import type {
  AppSettings,
  SaveHostnameCrawlPolicyInput,
  DocumentSource,
  LibraryFilters,
  ResolvedSourceDiscovery
} from '@loci/shared'
import type { LocalSourceMutationDatabase } from './local-source-mutation-database.js'
import type { CategoryDatabase } from './category-database.js'
import type { ClearDataDatabase } from './clear-data-database.js'
import type {
  BackupExportOptions,
  BackupImportOptions,
  BackupImportSummary,
  LociBackup
} from './database-backup.js'
import type { CrawlHistoryDatabase } from './crawl-history-database.js'
import type { SourceConfig } from './database-local-source.js'
import type { DocumentContentDatabase, StoredDocument } from './document-content-database.js'
import type { MutationDatabase } from './document-mutation.js'
import type { MoveDocumentsInput, MoveDocumentsResult } from './document-move-database.js'
import type { ExplicitPageDatabase } from './explicit-page-database.js'
import type { InteractionPreferencesDatabase } from './interaction-preferences.js'
import type { HostnameCrawlPolicyDatabase } from './hostname-crawl-policy-database.js'
import type { SettingsDatabase } from './settings-database.js'
import type { SkillInstallationDatabase } from './skill-database.js'

export interface SourceCrawlCommit {
  documents: StoredDocument[]
  deletedUrls: string[]
  replaceAll: boolean
  run?: { id: string; progress: CrawlProgress }
  explicitPages?: readonly ExplicitPageResult[]
  resolution: {
    firstUrl: string
    mode: 'http' | 'browser'
    iconUrl: string | null
    discovery: ResolvedSourceDiscovery
    github?: { defaultBranch: string; revision: string }
  }
}

export interface LociDatabase
  extends
    LocalSourceMutationDatabase,
    CategoryDatabase,
    ClearDataDatabase,
    SettingsDatabase,
    InteractionPreferencesDatabase,
    HostnameCrawlPolicyDatabase,
    CrawlHistoryDatabase,
    MutationDatabase,
    DocumentContentDatabase,
    SkillInstallationDatabase,
    ExplicitPageDatabase {
  patchAppSettings: (partial: Partial<AppSettings>) => AppSettings
  patchHostnamePolicy: (
    hostname: string,
    partial: Partial<Omit<SaveHostnameCrawlPolicyInput, 'hostname'>>
  ) => ReturnType<HostnameCrawlPolicyDatabase['saveHostnameCrawlPolicy']>
  schemaVersion: number
  clearDocuments: () => number
  clearSources: () => number
  hasSource: (id: string) => boolean
  readSnapshot: <T>(read: () => T) => T
  listSources: (filters?: LibraryFilters) => DocumentSource[]
  getSource: (id: string) => DocumentSource
  updateResolvedSource: (
    id: string,
    firstUrl: string,
    mode: 'http' | 'browser',
    iconUrl: string | null,
    github?: { defaultBranch: string; revision: string },
    discovery?: ResolvedSourceDiscovery
  ) => void
  replaceSourceDocuments: (sourceId: string, documents: StoredDocument[]) => void
  commitSourceCrawl: (id: string, commit: SourceCrawlCommit) => boolean
  updateGithubBlocked: (
    id: string,
    blocked: { revision: string; kind: 'archive' | 'markdown'; limitBytes: number }
  ) => void
  getSourceConfig: (id: string) => SourceConfig
  exportBackup: (options?: BackupExportOptions) => LociBackup
  importBackup: (input: unknown, options?: BackupImportOptions) => BackupImportSummary
  exportBackupArchive: (options?: BackupExportOptions) => Promise<Buffer>
  getBackupImportSummary: (operationId: string) => BackupImportSummary | undefined
  importBackupArchive: (
    input: Buffer,
    options?: BackupImportOptions,
    operationId?: string
  ) => Promise<BackupImportSummary>
  moveDocumentsToNewSource: (input: MoveDocumentsInput) => MoveDocumentsResult
  close: () => void
}
