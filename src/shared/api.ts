export type FetchMode = 'auto' | 'http' | 'browser'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface AppSettings {
  mcpPort: number
  theme: ThemeMode
  httpConcurrency: number
  browserConcurrency: number
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

export type AgentClient = 'codex' | 'cursor' | 'vscode' | 'claude-code' | 'gemini-cli'

export interface AgentImportResult {
  client: AgentClient
  message: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mcpPort: 37373,
  theme: 'auto',
  httpConcurrency: 9,
  browserConcurrency: 2
}

export type SourceStatus = 'healthy' | 'syncing' | 'attention'

export interface DocumentSource {
  id: string
  name: string
  url: string
  mode: FetchMode
  status: SourceStatus
  pages: number
  pageLimit: number
  lastUpdated: string
  schedule: string | null
  concurrency: number | null
  iconUrl: string | null
}

export interface CreateSourceInput {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
  schedule: string | null
  concurrency: number | null
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
  'not_found' | 'out_of_scope_redirect' | 'http_error' | 'request_error'

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
}

export interface CrawlRunState {
  sourceId: string
  progress: CrawlProgress
  nodes: CrawlNode[]
  error: string | null
  running: boolean
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
  listCrawlRuns: () => Promise<CrawlRunState[]>
  onCrawlProgress: (listener: (event: CrawlProgressEvent) => void) => () => void
  listDocuments: () => Promise<DocumentRecord[]>
  searchDocuments: (query: string) => Promise<DocumentRecord[]>
  deleteSource: (id: string) => Promise<void>
  getSettings: () => Promise<AppSettingsState>
  saveSettings: (settings: AppSettings) => Promise<AppSettingsState>
  importAgentClient: (client: AgentClient) => Promise<AgentImportResult>
}
