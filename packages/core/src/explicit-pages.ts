import { createPathExclusionMatcher } from '@loci/shared'
import { throwIfAborted } from './abort.js'
import { fetchHttpPage, getHostname, normalizeUrl } from './crawl.js'
import { fetchCrawledPageWithRetry, type RenderedCrawler } from './rendered.js'
import { probeSourcePage, type SourceFetchMode } from './source.js'
import type { CrawledDocument, CrawledPage, CrawlFailure, FetchOptions } from './types.js'

export type ExplicitPageStatus = 'fetched' | 'missing' | 'failed'

export interface ExplicitPageResult {
  url: string
  status: ExplicitPageStatus
  document?: CrawledDocument
  failure?: CrawlFailure
}

export interface ExplicitPagesResult {
  fetchMode: Exclude<SourceFetchMode, 'auto'>
  iconUrl: string | null
  items: ExplicitPageResult[]
}

export interface ExplicitPagesOptions extends FetchOptions {
  urls: readonly string[]
  hostname: string
  excludePathPattern?: string | null
  fetchMode: SourceFetchMode
  concurrency: number
  crawler?: RenderedCrawler
  beforeBrowserCrawl?: () => Promise<void>
}

export interface ExplicitPageUrlCheck {
  url: string
  error?: string
}

/** 精确读取指定页面；不会发现 Sitemap，也不会跟随页面内链接。 */
export async function fetchExplicitPages(
  options: ExplicitPagesOptions
): Promise<ExplicitPagesResult> {
  const urls = validateExplicitPageUrls(options)
  if (!urls.length) throw new Error('至少需要一个指定页面 URL')
  const selected = await selectModeAndFirstPage(options, urls[0])
  const results = new Array<ExplicitPageResult>(urls.length)
  let iconUrl = selected.firstPage?.page?.iconUrl ?? null
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < urls.length) {
      throwIfAborted(options.signal)
      const index = cursor++
      const url = urls[index]
      if (!url) continue
      try {
        const page =
          index === 0 && selected.firstPage
            ? selected.firstPage
            : await fetchPage(options, url, selected.fetchMode)
        iconUrl ??= page.page?.iconUrl ?? null
        results[index] = toExplicitResult(url, page, selected.fetchMode, options)
      } catch (error) {
        throwIfAborted(options.signal)
        results[index] = {
          url,
          status: 'failed',
          failure: {
            url,
            reason: 'request_error',
            message: error instanceof Error ? error.message : '页面请求失败',
            retryable: true
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, urls.length) }, () => worker())
  )
  return {
    fetchMode: selected.fetchMode,
    iconUrl,
    items: results
  }
}

export function validateExplicitPageUrls(options: {
  urls: readonly string[]
  hostname: string
  excludePathPattern?: string | null
}): string[] {
  const checked = classifyExplicitPageUrls(options)
  const invalid = checked.find((item) => item.error)
  if (invalid?.error) throw new Error(invalid.error)
  return checked.map((item) => item.url)
}

export function classifyExplicitPageUrls(options: {
  urls: readonly string[]
  hostname: string
  excludePathPattern?: string | null
}): ExplicitPageUrlCheck[] {
  const isExcluded = createPathExclusionMatcher(options.excludePathPattern)
  const checked: ExplicitPageUrlCheck[] = []
  const seen = new Set<string>()
  for (const input of options.urls) {
    let url: string
    try {
      url = normalizeUrl(input)
    } catch {
      checked.push({ url: input, error: `指定页面 URL 无效：${input}` })
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    if (getHostname(url) !== options.hostname) {
      checked.push({ url, error: `指定页面必须属于 ${options.hostname}：${url}` })
    } else if (isExcluded?.(url)) {
      checked.push({ url, error: `指定页面命中了排除路径：${url}` })
    } else {
      checked.push({ url })
    }
  }
  return checked
}

async function selectModeAndFirstPage(options: ExplicitPagesOptions, firstUrl: string) {
  if (options.fetchMode !== 'auto') {
    if (options.fetchMode === 'browser') await options.beforeBrowserCrawl?.()
    return { fetchMode: options.fetchMode, firstPage: undefined }
  }
  return probeSourcePage({
    firstUrl,
    hostname: options.hostname,
    pageLimit: 1,
    fetchMode: options.fetchMode,
    crawler: options.crawler,
    beforeBrowserCrawl: options.beforeBrowserCrawl,
    fetch: options.fetchImpl,
    maxRetries: options.maxRetries,
    sleep: options.sleep,
    signal: options.signal,
    onDocument: () => undefined
  })
}

function fetchPage(
  options: ExplicitPagesOptions,
  url: string,
  mode: Exclude<SourceFetchMode, 'auto'>
): Promise<CrawledPage> {
  if (mode === 'http') {
    return fetchHttpPage(url, {
      fetchImpl: options.fetchImpl,
      maxRetries: options.maxRetries,
      sleep: options.sleep,
      signal: options.signal
    })
  }
  if (!options.crawler) throw new Error('当前环境没有可用的浏览器抓取器')
  return fetchCrawledPageWithRetry(options.crawler, url, { hostname: options.hostname }, options)
}

function toExplicitResult(
  requestedUrl: string,
  result: CrawledPage,
  fetchMode: CrawledDocument['fetchMode'],
  options: Pick<ExplicitPagesOptions, 'hostname' | 'excludePathPattern'>
): ExplicitPageResult {
  const finalUrl = normalizeUrl(result.url)
  if (
    getHostname(finalUrl) !== options.hostname ||
    createPathExclusionMatcher(options.excludePathPattern)?.(finalUrl)
  ) {
    return {
      url: requestedUrl,
      status: 'failed',
      failure: {
        url: requestedUrl,
        reason: 'out_of_scope_redirect',
        message: '页面跳转到了不允许的地址',
        retryable: false,
        redirectUrl: finalUrl
      }
    }
  }
  if (result.status === 404 || result.status === 410) {
    return {
      url: requestedUrl,
      status: 'missing',
      failure: {
        url: requestedUrl,
        reason: 'not_found',
        message: `页面返回 HTTP ${result.status}`,
        retryable: false,
        statusCode: result.status
      }
    }
  }
  if (!result.page || result.status < 200 || result.status >= 300) {
    return {
      url: requestedUrl,
      status: 'failed',
      failure: {
        url: requestedUrl,
        reason: 'http_error',
        message: `页面返回 HTTP ${result.status}`,
        retryable: result.status === 408 || result.status === 429 || result.status >= 500,
        statusCode: result.status
      }
    }
  }
  return {
    url: requestedUrl,
    status: 'fetched',
    document: {
      url: requestedUrl,
      title: result.page.title,
      language: result.page.language,
      markdown: result.page.markdown,
      crawledAt: new Date().toISOString(),
      fetchMode
    }
  }
}
