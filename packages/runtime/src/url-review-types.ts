import type { CrawledDocument, CrawlFailure } from '@loci/core'

export type UrlReviewStatus =
  'discovering' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled'
export type UrlReviewDiscovery = 'new' | 'llms' | 'openapi' | 'sitemap' | 'pages'
export type UrlReviewTitleSource =
  'provided' | 'stored' | 'link_text' | 'llms' | 'openapi' | 'pathname'

export interface UrlReviewRun {
  id: string
  sourceId: string
  goal: string
  status: UrlReviewStatus
  discovery: UrlReviewDiscovery
  fetchMode: 'auto' | 'http' | 'browser'
  firstUrl: string
  iconUrl: string | null
  limitReached: boolean
  error: string | null
}

export interface UrlReviewCandidateInput {
  url: string
  title: string
  titleSource: UrlReviewTitleSource
  discoveredFrom?: string
  decision?: 'pending' | 'approved'
  document?: CrawledDocument
}

export interface UrlReviewCandidate extends Omit<UrlReviewCandidateInput, 'decision'> {
  id: string
  runId: string
  decision: 'pending' | 'approved' | 'excluded'
  batchId: string | null
  processed: boolean
  failure?: CrawlFailure
}

export interface UrlReviewSnapshot {
  run: UrlReviewRun
  batchId?: string
  candidates: UrlReviewCandidate[]
  discoveredCount: number
  approvedCount: number
  excludedCount: number
  processedCount: number
  failedCount: number
}
