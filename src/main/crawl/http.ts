import type { CrawlProgress } from '../../shared/api'
import { parsePage } from './content'
import { fetchWithRetry, type FetchOptions } from './fetch'
import { runCrawlQueue, type CrawledDocument, type CrawledPage } from './runner'
import { parseSitemap } from './sitemap'
import { normalizeUrl } from './url'

export type { CrawledDocument, CrawledPage, CrawlProgress }

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
  onError?: (error: { url: string; status?: number; missing?: boolean }) => Promise<void> | void
  onProgress?: (progress: CrawlProgress) => void
}

export async function fetchHttpPage(
  url: string,
  options: Pick<FetchOptions, 'fetchImpl' | 'sleep'> = {}
): Promise<CrawledPage> {
  const response = await fetchWithRetry(url, options)
  const finalUrl = normalizeUrl(response.url || url)
  return {
    url: finalUrl,
    status: response.status,
    ...(response.ok ? { page: parsePage(await response.text(), finalUrl) } : {})
  }
}

export async function discoverSitemapUrls(
  firstUrl: string,
  hostname: string,
  pageLimit: number,
  options: Pick<FetchOptions, 'fetchImpl' | 'sleep'> = {}
): Promise<string[]> {
  try {
    const sitemapUrl = new URL('/sitemap.xml', firstUrl).toString()
    const response = await fetchWithRetry(sitemapUrl, options)
    if (!response.ok) return []
    return parseSitemap(await response.text(), sitemapUrl, hostname, pageLimit + 1)
  } catch {
    return []
  }
}

export async function crawlHttpSource(options: HttpCrawlOptions): Promise<CrawlProgress> {
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    options.pageLimit,
    { fetchImpl: options.fetch, sleep: options.sleep }
  )
  return runCrawlQueue({
    ...options,
    concurrency: options.concurrency ?? 9,
    fetchMode: 'http',
    sitemapUrls,
    fetchPage: (url) => fetchHttpPage(url, { fetchImpl: options.fetch, sleep: options.sleep })
  })
}
