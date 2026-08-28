import type { CrawlProgress } from '@loci/core'
import type {
  CreateSourceInput,
  CrawlRunState,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import type { AgentIntegrationOptions, AgentIntegrationService } from './agent-integration.js'
import type { BrowserInstallPrompt, LocalBrowserCrawler } from './browser-crawler.js'
import type { BrowserManager } from './browser-manager.js'
import type { CloudAdminClient } from './cloud-admin-client.js'
import type { CloudLibraryService } from './cloud-library-service.js'
import type { LociDatabase } from './database.js'
import type { ExplicitPageFetchResult } from './explicit-page-service.js'
import type { UrlReviewService } from './url-review-service.js'

export interface LocalRuntime {
  dataDir: string
  cacheDir: string
  database: LociDatabase
  cloud: CloudLibraryService
  admin: CloudAdminClient
  browserManager: BrowserManager
  agentIntegration?: AgentIntegrationService
  urlReviews: UrlReviewService
  crawlSource: (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    localJob?: { id: string; owner: string }
  ) => Promise<CrawlProgress>
  fetchPages: (
    sourceId: string,
    urls: readonly string[],
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<ExplicitPageFetchResult>
  createSource: (input: CreateSourceInput) => DocumentSource
  deleteSource: (sourceId: string) => void
  updateSourcePreservingSchedule: (
    source: DocumentSource,
    input: Omit<UpdateSourceInput, 'schedule'>
  ) => DocumentSource
  updateSourceSchedule: (source: DocumentSource, schedule: string | null) => DocumentSource
  isCrawling: (sourceId: string) => boolean
  getCrawlState: (sourceId: string) => CrawlRunState | undefined
  resetCrawlStates: () => void
  assertWritable: () => void
  close: () => Promise<void>
}

export interface LocalRuntimeOptions {
  dataDir?: string
  cacheDir?: string
  owner?: string
  /** 新数据库及未自定义设置使用的 Server 默认值，仍允许用户修改。 */
  defaultServerUrl?: string
  browser?: LocalBrowserCrawler
  agentIntegration?: Omit<AgentIntegrationOptions, 'database' | 'dataDir'>
}
