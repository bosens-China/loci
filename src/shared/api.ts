export type FetchMode = 'auto' | 'http' | 'browser'

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
  schedule: string
}

export interface CreateSourceInput {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
}

export type UpdateSourceInput = CreateSourceInput

export interface CrawlProgress {
  queued: number
  processed: number
  succeeded: number
  failed: number
  limitReached: boolean
  node?: CrawlNode
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

export interface DocHubApi {
  listSources: () => Promise<DocumentSource[]>
  createSource: (input: CreateSourceInput) => Promise<DocumentSource>
  updateSource: (id: string, input: UpdateSourceInput) => Promise<DocumentSource>
  crawlSource: (id: string) => Promise<CrawlProgress>
  listCrawlRuns: () => Promise<CrawlRunState[]>
  onCrawlProgress: (listener: (event: CrawlProgressEvent) => void) => () => void
  listDocuments: () => Promise<DocumentRecord[]>
  searchDocuments: (query: string) => Promise<DocumentRecord[]>
  deleteSource: (id: string) => Promise<void>
}
