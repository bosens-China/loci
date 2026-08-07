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

export interface CrawlProgress {
  queued: number
  processed: number
  succeeded: number
  failed: number
  limitReached: boolean
  failures?: CrawlFailure[]
  node?: CrawlNode
}

export interface ParsedPage {
  title: string
  language: string
  markdown: string
  links: string[]
  iconUrl?: string
}

export interface CrawledDocument {
  url: string
  title: string
  language: string
  markdown: string
  crawledAt: string
  fetchMode: 'http' | 'browser'
  relativePath?: string
}

export interface CrawledPage {
  url: string
  status: number
  retryAfter?: string | null
  page?: ParsedPage
}

export interface FetchOptions {
  timeoutMs?: number
  maxRetries?: number
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  signal?: AbortSignal
}

export interface HttpCrawlOptions {
  firstUrl: string
  firstNodeId?: string
  hostname: string
  scopePath?: string
  pageLimit: number
  initialUrls?: readonly string[]
  seedPage?: CrawledPage
  concurrency?: number
  fetch?: FetchOptions['fetchImpl']
  sleep?: FetchOptions['sleep']
  maxRetries?: number
  batchIntervalMs?: number
  signal?: AbortSignal
  waitIfPaused?: () => Promise<void>
  onDocument: (document: CrawledDocument) => Promise<void> | void
  onError?: (error: CrawlFailure & { missing?: boolean }) => Promise<void> | void
  onProgress?: (progress: CrawlProgress) => void
}
