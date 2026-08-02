import type { CrawlProgress } from '../../shared/api'
import { fetchRenderedPage } from './browser'
import { parsePage } from './content'
import { discoverSitemapUrls, type HttpCrawlOptions } from './http'
import type { FetchOptions } from './fetch'
import { runCrawlQueue, type CrawledDocument, type CrawledPage } from './runner'
import { normalizeUrl } from './url'

export interface RenderedCrawlOptions {
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
  onError?: HttpCrawlOptions['onError']
  onProgress?: (progress: CrawlProgress) => void
}

export async function fetchRenderedCrawlPage(url: string, hostname?: string): Promise<CrawledPage> {
  const response = await fetchRenderedPage(url, { hostname })
  const finalUrl = normalizeUrl(response.url || url)
  return {
    url: finalUrl,
    status: response.status,
    ...(response.status >= 200 && response.status < 300
      ? { page: parsePage(response.html, finalUrl) }
      : {})
  }
}

export async function crawlRenderedSource(options: RenderedCrawlOptions): Promise<CrawlProgress> {
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    options.pageLimit,
    { fetchImpl: options.fetch, sleep: options.sleep }
  )
  return runCrawlQueue({
    ...options,
    concurrency: options.concurrency ?? 2,
    fetchMode: 'browser',
    sitemapUrls,
    fetchPage: (url) => fetchRenderedCrawlPage(url, options.hostname)
  })
}
