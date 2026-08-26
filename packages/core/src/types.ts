import type { CrawlFailure, CrawlProgress } from '@loci/shared'

export type {
  CrawlFailure,
  CrawlFailureReason,
  CrawlNode,
  CrawlNodeStatus,
  CrawlProgress
} from '@loci/shared'

export interface ParsedPage {
  title: string
  language: string
  markdown: string
  links: string[]
  linkCandidates?: PageLinkCandidate[]
  iconUrl?: string
}

export interface PageLinkCandidate {
  url: string
  title: string
  titleSource: 'link_text' | 'pathname'
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

export interface CrawlDuplicate {
  url: string
  duplicateOf: string
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
  excludePathPattern?: string | null
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
  onDuplicate?: (duplicate: CrawlDuplicate) => Promise<void> | void
  onError?: (error: CrawlFailure & { missing?: boolean }) => Promise<void> | void
  onProgress?: (progress: CrawlProgress) => void
}
