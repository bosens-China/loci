import type { CrawlProgress, ExplicitPageResult } from '@loci/core'
import type { LociDatabase, SourceConfig } from './database.js'
import type { BrowserInstallPrompt, LocalBrowserCrawler } from './browser-crawler.js'
import type { StoredDocument } from './document-content-database.js'
import { explicitPageProgress, fetchSourceExplicitPages } from './explicit-page-service.js'

export interface ReviewedSourceRefreshResult {
  progress: CrawlProgress
  pages: ExplicitPageResult[]
  documents: StoredDocument[]
  deletedUrls: string[]
  resolution: {
    firstUrl: string
    fetchMode: 'http' | 'browser'
    iconUrl: string | null
  }
}

/** 无 Agent 的同步只刷新已经收录的精确 URL，不发现或批准新页面。 */
export async function refreshReviewedSource(
  database: LociDatabase,
  browser: LocalBrowserCrawler,
  source: SourceConfig,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  onProgress?: (progress: CrawlProgress) => void
): Promise<ReviewedSourceRefreshResult> {
  const urls = database.listDocumentUrls(source.id)
  if (!urls.length) {
    return {
      progress: { queued: 0, processed: 0, succeeded: 0, failed: 0, limitReached: false },
      pages: [],
      documents: [],
      deletedUrls: [],
      resolution: {
        firstUrl: source.firstUrl,
        fetchMode: source.fetchMode === 'browser' ? 'browser' : 'http',
        iconUrl: null
      }
    }
  }
  const result = await fetchSourceExplicitPages({
    database,
    browser,
    source,
    urls,
    signal,
    onProgress,
    onBrowserMissing
  })
  return {
    progress: explicitPageProgress(result.items),
    pages: result.items,
    documents: result.items.flatMap((item) =>
      item.document ? [{ ...item.document, sourceId: source.id }] : []
    ),
    deletedUrls: result.items.flatMap((item) => (item.status === 'missing' ? [item.url] : [])),
    resolution: {
      firstUrl: source.firstUrl,
      fetchMode: result.fetchMode,
      iconUrl: result.iconUrl
    }
  }
}
