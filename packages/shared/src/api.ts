import type { AgentGlobalRulesClient, AgentClient } from './agent-clients.js'

export type FetchMode = 'auto' | 'http' | 'browser'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemeMode
  httpConcurrency: number
  browserConcurrency: number
  maxRetries: number
  batchIntervalSeconds: number
  batchIntervalMaxSeconds: number
  githubArchiveLimitMb: number
  githubMarkdownLimitMb: number
}

export interface AgentGlobalRulesResult {
  client: AgentGlobalRulesClient
  path: string
  changed: boolean
  message: string
}

export type AgentIntegrationComponent = 'skill' | 'rules' | 'legacy-mcp'
export type AgentIntegrationComponentStatus =
  'missing' | 'current' | 'outdated' | 'replaceable' | 'conflict' | 'manual'
export type AgentIntegrationOverallStatus = 'ready' | 'partial' | 'missing' | 'attention'

export interface AgentIntegrationComponentState {
  component: AgentIntegrationComponent
  status: AgentIntegrationComponentStatus
  path: string
  message: string | null
  manualContent?: string
  backupPath?: string
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

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'auto',
  httpConcurrency: 9,
  browserConcurrency: 5,
  maxRetries: 3,
  batchIntervalSeconds: 0,
  batchIntervalMaxSeconds: 0,
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
export type ResolvedSourceDiscovery = 'github' | 'llms' | 'openapi' | 'pages'

export interface CategorySummary {
  name: string
  libraryCount: number
  isDefault?: boolean
  createdAt: string
}

export interface LibraryFilters {
  query?: string
  category?: string
  version?: string
}

export type ClearDataScope = 'documents' | 'sources'

export interface ClearDataCounts {
  libraries: number
  documents: number
}

export interface ClearDataSummary extends ClearDataCounts {
  scope: ClearDataScope
}

export interface BackupImportSummary {
  mode: 'merge' | 'replace'
  importedLibraries: number
  replacedLibraries: number
  importedDocuments: number
  categoriesCreated: number
  sources: number
  documents: number
}

export interface DocumentSource {
  category: string
  version: string
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
  /** 旧版导入的远端快照可在本机读取、导出及删除。 */
  readOnly: boolean
  updatedAt: string
  lastUpdated: string
  httpConcurrency: number | null
  browserConcurrency: number | null
  iconUrl: string | null
  kind: SourceKind
  githubArchiveLimitMb: number | null
  githubMarkdownLimitMb: number | null
  githubDefaultBranch: string | null
  githubRevision: string | null
  resolvedDiscovery: ResolvedSourceDiscovery | null
}

export interface CreateSourceInput {
  category?: string | null
  version?: string | null
  name: string
  url: string
  kind?: SourceKind
  mode: FetchMode
  pageLimit: number
  scopePath?: string
  excludePathPattern?: string | null
  httpConcurrency: number | null
  browserConcurrency: number | null
  githubArchiveLimitMb?: number | null
  githubMarkdownLimitMb?: number | null
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

export type ExplicitPageWriteStatus = 'inserted' | 'updated' | 'unchanged' | 'missing' | 'failed'
export interface ExplicitPageWriteResult {
  url: string
  status: ExplicitPageWriteStatus
  message?: string
}

export interface LibraryCrawlStatus {
  libraryId: string
  runId: string
  kind: 'sync' | 'pages'
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'
  progress: {
    discovered: number
    processed: number
    succeeded: number
    failed: number
    currentUrl: string | null
  }
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  failures?: Array<{ url: string; message: string }>
}

export interface ForegroundCrawlState {
  items?: ExplicitPageWriteResult[]
  libraryId: string
  kind: 'sync' | 'pages'
  status: LibraryCrawlStatus['status']
  progress: CrawlProgress | null
  error: string | null
}

export interface DocumentSummary {
  id: string
  sourceId: string
  sourceName: string
  title: string
  url: string
  relativePath?: string
  folder: string
  language: string
  updatedAt: string
}

export interface DocumentRecord extends DocumentSummary {
  content: string
}

/** 文档浏览的轻量文件元数据。 */
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
  /** 完整 Markdown 正文的 UTF-8 字节数。 */
  contentBytes?: number
  offset: number
  nextOffset?: number
  totalChars: number
  truncated: boolean
}
