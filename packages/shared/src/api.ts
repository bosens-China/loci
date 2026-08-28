import type { AgentClient, AgentGlobalRulesClient } from './mcp-clients.js'

export type FetchMode = 'auto' | 'http' | 'browser'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemeMode
  httpConcurrency: number
  browserConcurrency: number
  maxRetries: number
  batchIntervalSeconds: number
  batchIntervalMaxSeconds: number
  serverUrl: string
  githubArchiveLimitMb: number
  githubMarkdownLimitMb: number
}

export const RESOURCE_REVISION_KEYS = ['sources', 'documents', 'jobs', 'settings', 'logs'] as const

export type ResourceRevisionKey = (typeof RESOURCE_REVISION_KEYS)[number]

export type ResourceRevisions = Record<ResourceRevisionKey, number>

export const SERVER_RESOURCE_REVISION_KEYS = [
  'libraries',
  'jobs',
  'hostnamePolicies',
  'crawlSettings',
  'auditLogs'
] as const

export type ServerResourceRevisionKey = (typeof SERVER_RESOURCE_REVISION_KEYS)[number]

/** Server 管理 UI 可观察的持久资源版本，仅用于失效本地查询缓存。 */
export type ServerResourceRevisions = Record<ServerResourceRevisionKey, number>

export interface AgentImportResult {
  client: AgentClient
  message: string
}

export interface AgentGlobalRulesResult {
  client: AgentGlobalRulesClient
  path: string
  changed: boolean
  message: string
}

export type AgentIntegrationComponent = 'mcp' | 'skill' | 'rules'
export type AgentIntegrationComponentStatus =
  'missing' | 'current' | 'outdated' | 'conflict' | 'manual'
export type AgentIntegrationOverallStatus = 'ready' | 'partial' | 'missing' | 'attention'

export interface AgentIntegrationComponentState {
  component: AgentIntegrationComponent
  status: AgentIntegrationComponentStatus
  path: string
  message: string | null
  manualContent?: string
}

export interface AgentIntegrationStatus {
  client: AgentClient
  label: string
  overall: AgentIntegrationOverallStatus
  components: AgentIntegrationComponentState[]
}

export interface AgentIntegrationActionResult {
  action: 'setup' | 'remove'
  changed: boolean
  status: AgentIntegrationStatus
}

export interface CloudAdminLoginInput {
  username: string
  password: string
}

export interface CloudAdminSession {
  serverUrl: string
  username: string
  expiresAt: string
}

export interface CloudLibraryInput {
  name: string
  url: string
  scopePath: string
  pageLimit: number
  schedule: string | null
}

export interface CloudLibrary extends CloudLibraryInput {
  id: string
  hostname: string
  pages: number
  lastCrawledAt: string | null
  lastError: string | null
  revision: string | null
  publishedAt: string | null
}

export interface CloudLibraryPublishResult {
  library: CloudLibrary
  revision: string
  publishedAt: string
  pages: number
  contentSize: number
  reused: boolean
}

export interface CloudCatalogItem {
  id: string
  name: string
  url: string
  revision: string
  pages: number
  contentSize: number
  lastCrawledAt: string | null
  publishedAt: string
  localSourceId: string | null
  localRevision: string | null
  autoSync: boolean
  updateAvailable: boolean
}

export interface CloudImportResult {
  source: DocumentSource
  updated: boolean
  documents: number
}

export type CloudSyncJobStatus =
  'queued' | 'running' | 'canceling' | 'canceled' | 'completed' | 'completed_with_errors' | 'failed'

export interface CloudSyncJob {
  id: string
  libraryId: string
  hostname: string
  status: CloudSyncJobStatus
  priority: number
  paused: boolean
  pauseRequested: boolean
  stopRequested: boolean
  partial: boolean
  contentBytes: number
  remainingCount: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  progress: CrawlProgress | null
  failures: CrawlFailure[]
  error: string | null
}

export const PRODUCTION_SERVER_URL = 'https://loci.xiaowo.live'
export const DEVELOPMENT_SERVER_URL = 'http://localhost:7001'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'auto',
  httpConcurrency: 9,
  browserConcurrency: 5,
  maxRetries: 3,
  batchIntervalSeconds: 0,
  batchIntervalMaxSeconds: 0,
  serverUrl: PRODUCTION_SERVER_URL,
  githubArchiveLimitMb: 200,
  githubMarkdownLimitMb: 100
}

export interface HostnameCrawlPolicy {
  hostname: string
  httpConcurrency: number | null
  browserConcurrency: number | null
  batchIntervalMinSeconds: number | null
  batchIntervalMaxSeconds: number | null
  updatedAt: string
}

export type SaveHostnameCrawlPolicyInput = Omit<HostnameCrawlPolicy, 'updatedAt'>

export type SourceStatus = 'healthy' | 'syncing' | 'attention'
export type SourceKind = 'web' | 'github'
export type SourceDiscoveryMode = 'site' | 'agent_review'
export type ResolvedSourceDiscovery = 'github' | 'llms' | 'openapi' | 'pages'

export interface DocumentSource {
  id: string
  name: string
  url: string
  mode: FetchMode
  status: SourceStatus
  pages: number
  contentSize: number
  pageLimit: number
  scopePath: string
  excludePathPattern?: string | null
  lastUpdated: string
  schedule: string | null
  httpConcurrency: number | null
  browserConcurrency: number | null
  iconUrl: string | null
  cloud: CloudSourceOrigin | null
  kind: SourceKind
  githubArchiveLimitMb: number | null
  githubMarkdownLimitMb: number | null
  githubDefaultBranch: string | null
  githubRevision: string | null
  discoveryMode: SourceDiscoveryMode
  resolvedDiscovery: ResolvedSourceDiscovery | null
  reviewGoal: string | null
}

export interface CloudSourceOrigin {
  serverUrl: string
  libraryId: string
  revision: string
  autoSync: boolean
}

export interface CreateSourceInput {
  name: string
  url: string
  kind?: SourceKind
  mode: FetchMode
  pageLimit: number
  scopePath?: string
  excludePathPattern?: string | null
  schedule: string | null
  httpConcurrency: number | null
  browserConcurrency: number | null
  githubArchiveLimitMb?: number | null
  githubMarkdownLimitMb?: number | null
  discoveryMode?: SourceDiscoveryMode
  reviewGoal?: string | null
}

export type UpdateSourceInput = CreateSourceInput

export interface CrawlProgress {
  queued: number
  processed: number
  succeeded: number
  failed: number
  limitReached: boolean
  failures?: CrawlFailure[]
  node?: CrawlNode
}

export type CrawlFailureReason =
  'not_found' | 'out_of_scope_redirect' | 'http_error' | 'request_error' | 'git_lfs_unsupported'

export interface CrawlFailure {
  url: string
  reason: CrawlFailureReason
  message: string
  retryable: boolean
  statusCode?: number
  redirectUrl?: string
}

export type CrawlNodeStatus = 'queued' | 'running' | 'success' | 'failed'

export interface CrawlNode {
  id: string
  url: string
  title: string
  status: CrawlNodeStatus
  parentId?: string
}

export interface CrawlRunState {
  sourceId: string
  progress: CrawlProgress
  nodes: CrawlNode[]
  error: string | null
  running: boolean
  paused: boolean
}

export type LocalJobKind = 'source_sync'
export type LocalJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type LocalJobTrigger = 'manual' | 'background' | 'schedule' | 'ui' | 'mcp'

/** 本地持久任务的浏览器安全传输契约。 */
export interface LocalJob {
  id: string
  kind: LocalJobKind
  resourceKey: string
  sourceId: string
  hostname: string
  trigger: LocalJobTrigger
  status: LocalJobStatus
  priority: number
  paused: boolean
  pauseRequested: boolean
  stopRequested: boolean
  partial: boolean
  contentBytes: number
  remainingCount: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  attemptCount: number
  cancelRequested: boolean
  error: string | null
  result: CrawlProgress | null
  createdAt: string
  updatedAt: string
}

export interface EnqueueLocalJobResult {
  job: LocalJob
  reused: boolean
}

export type LocalJobEventStatus = Extract<CrawlNodeStatus, 'success' | 'failed'>

/** 持久任务的逐页完成事件；sequence 可用于跨进程断点续读。 */
export interface LocalJobEvent {
  sequence: number
  jobId: string
  sourceId: string
  runId: string | null
  node: CrawlNode & { status: LocalJobEventStatus }
  progress: CrawlProgress
  createdAt: string
}

export type OperationLogLevel = 'info' | 'warning' | 'error'

/** 跨 UI、CLI、MCP、worker 的结构化操作记录。 */
export interface OperationLog {
  id: number
  category: 'task' | 'library' | 'settings' | 'cloud' | 'maintenance' | 'system'
  action: string
  level: OperationLogLevel
  resourceType: string | null
  resourceId: string | null
  hostname: string | null
  message: string
  details: Record<string, unknown> | null
  createdAt: string
}

export type CreateOperationLogInput = Pick<
  OperationLog,
  'category' | 'action' | 'level' | 'message'
> &
  Partial<Pick<OperationLog, 'resourceType' | 'resourceId' | 'hostname' | 'details'>> & {
    createdAt?: string
  }

export interface CreateSourceResult {
  source: DocumentSource
  sync: EnqueueLocalJobResult | null
  workerError: string | null
}

export interface DocumentSummary {
  id: string
  sourceId: string
  sourceName: string
  title: string
  url: string
  folder: string
  language: string
  updatedAt: string
}

export interface DocumentRecord extends DocumentSummary {
  content: string
}

/** 本地与云端渐进浏览共用的轻量文件契约。 */
export interface LibraryFileSummary {
  id: string
  libraryId: string
  title: string
  url: string
  path: string
  language: string
  updatedAt: string
}

export interface LibraryFileRecord extends LibraryFileSummary {
  content: string
  offset: number
  nextOffset?: number
  totalChars: number
  truncated: boolean
}
