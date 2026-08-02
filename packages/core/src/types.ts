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
}

export interface CrawledPage {
  url: string
  status: number
  page?: ParsedPage
}

export interface FetchOptions {
  timeoutMs?: number
  maxRetries?: number
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

export interface HttpCrawlOptions {
  firstUrl: string
  firstNodeId?: string
  hostname: string
  pageLimit: number
  initialUrls?: readonly string[]
  seedPage?: CrawledPage
  concurrency?: number
  fetch?: FetchOptions['fetchImpl']
  sleep?: FetchOptions['sleep']
  onDocument: (document: CrawledDocument) => Promise<void> | void
  onError?: (error: CrawlFailure & { missing?: boolean }) => Promise<void> | void
  onProgress?: (progress: CrawlProgress) => void
}
