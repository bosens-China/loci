import type { CrawlProgress, ExplicitPageResult } from '@loci/core'
import type {
  CreateSourceInput,
  DocumentSource,
  ResolvedSourceDiscovery,
  UpdateSourceInput
} from '@loci/shared'
import type { BackupImportSummary, LociBackup } from './database-backup.js'
import type { CloudLibraryDatabase } from './cloud-library-database.js'
import type { CrawlHistoryDatabase } from './crawl-history-database.js'
import type { SourceConfig } from './database-local-source.js'
import type { DocumentContentDatabase, StoredDocument } from './document-content-database.js'
import type { ExplicitPageDatabase } from './explicit-page-database.js'
import type { InteractionPreferencesDatabase } from './interaction-preferences.js'
import type { LocalJobDatabase } from './local-job-database.js'
import type { LocalJobEventDatabase } from './local-job-event-database.js'
import type { ResourceRevisionDatabase } from './resource-revision-database.js'
import type { SettingsDatabase } from './settings-database.js'
import type { SkillInstallationDatabase } from './skill-database.js'
import type { UrlReviewDatabase } from './url-review-database.js'

export interface SourceCrawlCommit {
  documents: StoredDocument[]
  deletedUrls: string[]
  replaceAll: boolean
  urlReview?: { runId: string; limitReached: boolean }
  localJob?: { id: string; owner: string; runId: string; result: CrawlProgress }
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
    CloudLibraryDatabase,
    SettingsDatabase,
    InteractionPreferencesDatabase,
    CrawlHistoryDatabase,
    DocumentContentDatabase,
    SkillInstallationDatabase,
    LocalJobDatabase,
    LocalJobEventDatabase,
    ResourceRevisionDatabase,
    ExplicitPageDatabase,
    UrlReviewDatabase {
  schemaVersion: number
  listSources: () => DocumentSource[]
  createSource: (input: CreateSourceInput) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  updateResolvedSource: (
    id: string,
    firstUrl: string,
    mode: 'http' | 'browser',
    iconUrl: string | null,
    github?: { defaultBranch: string; revision: string },
    discovery?: ResolvedSourceDiscovery
  ) => void
  commitSourceCrawl: (id: string, commit: SourceCrawlCommit) => boolean
  updateGithubBlocked: (
    id: string,
    blocked: { revision: string; kind: 'archive' | 'markdown'; limitBytes: number }
  ) => void
  getSourceConfig: (id: string) => SourceConfig
  deleteSource: (id: string) => void
  exportBackup: () => LociBackup
  importBackup: (input: unknown) => BackupImportSummary
  close: () => void
}
