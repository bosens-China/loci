import type { AgentClient, AgentGlobalRulesClient } from './mcp-clients.js'

export type FetchMode = 'auto' | 'http' | 'browser'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  mcpPort: number
  theme: ThemeMode
  httpConcurrency: number
  browserConcurrency: number
  maxRetries: number
  batchIntervalSeconds: number
  serverUrl: string
  githubArchiveLimitMb: number
  githubMarkdownLimitMb: number
}

export interface McpServerStatus {
  running: boolean
  endpoint: string
  error: string | null
}

export interface AppSettingsState {
  settings: AppSettings
  mcp: McpServerStatus
}

export interface OpenAtLoginState {
  supported: boolean
  enabled: boolean
}

export interface DesktopUpdateState {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  checkedAt: string | null
  autoUpdateSupported: boolean
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  downloadProgress: number | null
  error: string | null
  manualInstallHint: string | null
}

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

export interface DataTransferResult {
  canceled: boolean
  message: string
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
  status: CloudSyncJobStatus
  createdAt: string
  finishedAt: string | null
  progress: CrawlProgress | null
  failures: CrawlFailure[]
  error: string | null
}

export const PRODUCTION_SERVER_URL = 'https://loci.xiaowo.live'
export const DEVELOPMENT_SERVER_URL = 'http://localhost:7001'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mcpPort: 37373,
  theme: 'auto',
  httpConcurrency: 9,
  browserConcurrency: 5,
  maxRetries: 3,
  batchIntervalSeconds: 0,
  serverUrl: PRODUCTION_SERVER_URL,
  githubArchiveLimitMb: 200,
  githubMarkdownLimitMb: 100
}

export type SourceStatus = 'healthy' | 'syncing' | 'attention'
export type SourceKind = 'web' | 'github'

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
  mode: FetchMode
  pageLimit: number
  scopePath?: string
  schedule: string | null
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

export interface CrawlProgressEvent {
  sourceId: string
  progress: CrawlProgress
  error: string | null
  running: boolean
  paused: boolean
}

export interface CrawlRunState {
  sourceId: string
  progress: CrawlProgress
  nodes: CrawlNode[]
  error: string | null
  running: boolean
  paused: boolean
}

export interface DocumentRecord {
  id: string
  sourceId: string
  sourceName: string
  title: string
  url: string
  folder: string
  language: string
  updatedAt: string
  content: string
}

export interface LociApi {
  listSources: () => Promise<DocumentSource[]>
  createSource: (input: CreateSourceInput) => Promise<DocumentSource>
  updateSource: (id: string, input: UpdateSourceInput) => Promise<DocumentSource>
  crawlSource: (id: string) => Promise<CrawlProgress>
  pauseCrawl: (id: string) => Promise<void>
  resumeCrawl: (id: string) => Promise<void>
  listCrawlRuns: () => Promise<CrawlRunState[]>
  onCrawlProgress: (listener: (event: CrawlProgressEvent) => void) => () => void
  onExternalDataChange: (listener: () => void) => () => void
  listDocuments: () => Promise<DocumentRecord[]>
  searchDocuments: (query: string) => Promise<DocumentRecord[]>
  clearDocuments: () => Promise<number>
  deleteSource: (id: string) => Promise<void>
  getSettings: () => Promise<AppSettingsState>
  saveSettings: (settings: AppSettings) => Promise<AppSettingsState>
  getOpenAtLogin: () => Promise<OpenAtLoginState>
  setOpenAtLogin: (enabled: boolean) => Promise<OpenAtLoginState>
  getDesktopUpdate: () => Promise<DesktopUpdateState>
  checkDesktopUpdate: () => Promise<DesktopUpdateState>
  openDesktopRelease: () => Promise<void>
  importAgentClient: (client: AgentClient) => Promise<AgentImportResult>
  installAgentGlobalRules: (client: AgentGlobalRulesClient) => Promise<AgentGlobalRulesResult>
  exportData: () => Promise<DataTransferResult>
  importData: () => Promise<DataTransferResult>
  cloudAdminLogin: (input: CloudAdminLoginInput) => Promise<CloudAdminSession>
  cloudAdminLogout: () => Promise<void>
  getCloudAdminSession: () => Promise<CloudAdminSession | null>
  listCloudLibraries: () => Promise<CloudLibrary[]>
  createCloudLibrary: (input: CloudLibraryInput) => Promise<CloudLibrary>
  updateCloudLibrary: (id: string, input: CloudLibraryInput) => Promise<CloudLibrary>
  deleteCloudLibrary: (id: string) => Promise<void>
  syncCloudLibrary: (id: string) => Promise<CloudSyncJob>
  syncCloudLibraries: (ids: string[]) => Promise<CloudSyncJob[]>
  listCloudSyncJobs: () => Promise<CloudSyncJob[]>
  getCloudSyncJob: (id: string) => Promise<CloudSyncJob>
  cancelCloudSyncJob: (id: string) => Promise<CloudSyncJob>
  listCloudCatalog: () => Promise<CloudCatalogItem[]>
  importCloudLibrary: (libraryId: string, autoSync: boolean) => Promise<CloudImportResult>
  updateCloudLibraryCopy: (sourceId: string) => Promise<CloudImportResult>
  setCloudLibraryAutoSync: (sourceId: string, enabled: boolean) => Promise<void>
}
