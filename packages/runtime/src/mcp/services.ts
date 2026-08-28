import type {
  CloudCatalogItem,
  CloudImportResult,
  CloudLibrary,
  CloudLibraryInput,
  CloudLibraryPublishResult,
  CloudSyncJob,
  CreateSourceInput,
  CrawlProgress,
  CrawlRunState,
  CrawlFailure,
  DocumentRecord,
  DocumentSource,
  LocalJob,
  LibraryFileRecord,
  HostnameCrawlPolicy,
  OperationLog,
  SaveServerCrawlSettingsInput,
  ServerCrawlSettings,
  UrlTreeNode,
  UpdateSourceInput
} from '@loci/shared'
import type { SaveHostnameCrawlPolicyInput } from '@loci/shared'
import type { InspectSourceOptions, SourceInspection } from '@loci/core'
import type { DocumentSearchMode } from '../document-content-database.js'
import type { ExplicitPageFetchResult } from '../explicit-page-service.js'
import type { UrlReviewSnapshot } from '../url-review-database.js'
import type { OperationLogFilters } from '../operation-log-database.js'
import type { MoveDocumentsInput, MoveDocumentsResult } from '../document-move-database.js'

// MCP 仅依赖宿主能力接口，CLI 与后台服务可各自注入实现。
export interface LociMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string, mode?: DocumentSearchMode) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  inspectSource: (input: InspectSourceOptions) => Promise<SourceInspection>
  updateSource: (
    source: DocumentSource,
    input: Omit<UpdateSourceInput, 'schedule'>
  ) => DocumentSource
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void,
    signal?: AbortSignal
  ) => Promise<CrawlProgress>
  fetchPages: (
    id: string,
    urls: readonly string[],
    onProgress?: (progress: CrawlProgress) => void,
    signal?: AbortSignal
  ) => Promise<ExplicitPageFetchResult>
  startUrlReview: (id: string, goal?: string, signal?: AbortSignal) => Promise<UrlReviewSnapshot>
  submitUrlReview: (
    runId: string,
    batchId: string,
    excludeUrls: readonly string[],
    signal?: AbortSignal
  ) => Promise<UrlReviewSnapshot>
  getUrlReview: (runId: string) => UrlReviewSnapshot | undefined
  getActiveUrlReview: (libraryId: string) => UrlReviewSnapshot | undefined
  cancelUrlReview: (runId: string) => boolean
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
  getCrawlState: (id: string) => CrawlRunState | undefined
  getLatestCrawlRunId: (libraryId: string) => string | undefined
  getCrawlRunLibraryId: (runId: string) => string | undefined
  listCrawlFailures: (runId: string) => CrawlFailure[]
  listLocalJobs: (limit?: number) => LocalJob[]
  getLocalJob: (id: string) => LocalJob | undefined
  pauseLocalJob: (id: string) => LocalJob | undefined
  resumeLocalJob: (id: string) => LocalJob | undefined
  stopLocalJob: (id: string) => LocalJob | undefined
  cancelLocalJob: (id: string) => LocalJob | undefined
  setLocalJobPriority: (id: string, priority: number) => LocalJob | undefined
  pauseLocalJobs: (hostname?: string) => number
  resumeLocalJobs: (hostname?: string) => number
  listOperationLogs: (filters?: OperationLogFilters) => { total: number; items: OperationLog[] }
  listHostnameCrawlPolicies: () => HostnameCrawlPolicy[]
  saveHostnameCrawlPolicy: (input: SaveHostnameCrawlPolicyInput) => HostnameCrawlPolicy
  deleteHostnameCrawlPolicy: (hostname: string) => boolean
  listServerHostnamePolicies: () => Promise<HostnameCrawlPolicy[]>
  saveServerHostnamePolicy: (input: SaveHostnameCrawlPolicyInput) => Promise<HostnameCrawlPolicy>
  deleteServerHostnamePolicy: (hostname: string) => Promise<void>
  getServerCrawlSettings: () => Promise<ServerCrawlSettings>
  saveServerCrawlSettings: (input: SaveServerCrawlSettingsInput) => Promise<ServerCrawlSettings>
  listCloudLibraries: () => Promise<CloudCatalogItem[]>
  getCloudLibraryTree: (
    libraryId: string,
    parent?: string,
    depth?: number
  ) => Promise<UrlTreeNode[]>
  readCloudLibraryFile: (
    libraryId: string,
    fileId: string,
    offset?: number,
    maxChars?: number
  ) => Promise<LibraryFileRecord>
  pullCloudLibrary: (libraryId: string) => Promise<CloudImportResult>
  publishLocalLibrary: (
    sourceId: string,
    mode: 'create' | 'replace',
    targetLibraryId?: string
  ) => Promise<CloudLibraryPublishResult>
  moveDocumentsToNewSource: (input: MoveDocumentsInput) => MoveDocumentsResult
  listServerTasks: () => Promise<CloudSyncJob[]>
  controlServerTask: (
    id: string,
    action: 'pause' | 'resume' | 'stop' | 'cancel'
  ) => Promise<CloudSyncJob>
  setServerTaskPriority: (id: string, priority: number) => Promise<CloudSyncJob>
  controlServerTasks: (action: 'pause-all' | 'resume-all', hostname?: string) => Promise<number>
  listServerLibraries: () => Promise<CloudLibrary[]>
  createServerLibrary: (input: CloudLibraryInput) => Promise<CloudLibrary>
  updateServerLibrary: (id: string, input: CloudLibraryInput) => Promise<CloudLibrary>
  deleteServerLibrary: (id: string) => Promise<void>
  syncServerLibraries: (ids: readonly string[]) => Promise<CloudSyncJob[]>
}
