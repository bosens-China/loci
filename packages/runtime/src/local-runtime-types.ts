import type { CrawlProgress } from '@loci/core'
import type {
  CreateSourceInput,
  ClearDataScope,
  ClearDataSummary,
  CrawlRunState,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import type { AgentIntegrationOptions, AgentIntegrationService } from './agent-integration.js'
import type { BrowserInstallPrompt, LocalBrowserCrawler } from './browser-crawler.js'
import type { BrowserManager } from './browser-manager.js'
import type { LociDatabase } from './database.js'
import type { ExplicitPageFetchResult } from './explicit-page-service.js'

import type { DocumentQuery } from './document-query.js'

import type { DocumentMutation } from './document-mutation.js'
import type { CategoryDatabase } from './category-database.js'
import type { BackupImportSummary } from '@loci/shared'
import type { BackupImportOptions } from './database-backup.js'
import type { LibraryCrawlStatuses } from './library-crawl-status.js'

export interface LocalRuntime
  extends CategoryDatabase, DocumentQuery, DocumentMutation, LibraryCrawlStatuses {
  dataDir: string
  cacheDir: string
  database: LociDatabase
  browserManager: BrowserManager
  agentIntegration?: AgentIntegrationService
  crawlSource: (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    additionalUrls?: readonly string[]
  ) => Promise<CrawlProgress>
  fetchPages: (
    sourceId: string,
    urls: readonly string[],
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<ExplicitPageFetchResult>
  createSource: (
    input: Pick<CreateSourceInput, 'url'> & Partial<CreateSourceInput>,
    allowContentRemoval?: boolean
  ) => DocumentSource
  upsertSource: LocalRuntime['createSource']
  patchSource: (
    id: string,
    input: Partial<Omit<UpdateSourceInput, 'url' | 'kind'>>,
    allowContentRemoval?: boolean
  ) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  isCrawling: (sourceId: string) => boolean
  getCrawlState: (sourceId: string) => CrawlRunState | undefined
  resetCrawlStates: () => void
  /** 导出和恢复在同一数据目录取得维护锁，CLI 与前台 Web 共用。 */
  exportBackupArchive: LociDatabase['exportBackupArchive']
  importBackupArchive: (
    input: Buffer,
    options?: BackupImportOptions
  ) => Promise<BackupImportSummary>
  getClearDataCounts: LociDatabase['getClearDataCounts']
  clearData: (scope: ClearDataScope, signal?: AbortSignal) => Promise<ClearDataSummary>
  patchAppSettings: LociDatabase['patchAppSettings']
  patchHostnamePolicy: LociDatabase['patchHostnamePolicy']
  saveSettings: LociDatabase['saveSettings']
  saveHostnameCrawlPolicy: LociDatabase['saveHostnameCrawlPolicy']
  deleteHostnameCrawlPolicy: LociDatabase['deleteHostnameCrawlPolicy']
  assertWritable: () => void
  close: () => Promise<void>
}

export interface LocalRuntimeOptions {
  /** 专属 CLI 子进程由一个库独占，遇到其他持有者时直接回报调用方。 */
  detachedCrawl?: boolean
  dataDir?: string
  cacheDir?: string
  owner?: string
  browser?: LocalBrowserCrawler
  agentIntegration?: Omit<AgentIntegrationOptions, 'database' | 'dataDir'>
}
