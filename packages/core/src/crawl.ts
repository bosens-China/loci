import { parse } from 'node-html-parser'
import { htmlToMarkdown } from 'mdream'
import { isUrlInScope } from './scope.js'
import type {
  CrawledDocument,
  CrawledPage,
  CrawlFailure,
  CrawlNode,
  CrawlProgress,
  FetchOptions,
  HttpCrawlOptions,
  ParsedPage
} from './types.js'

export type {
  CrawledDocument,
  CrawledPage,
  CrawlFailure,
  CrawlNode,
  CrawlProgress,
  FetchOptions,
  HttpCrawlOptions,
  ParsedPage
} from './types.js'

interface CrawlRunnerOptions extends HttpCrawlOptions {
  concurrency: number
  fetchMode: CrawledDocument['fetchMode']
  sitemapUrls?: readonly string[]
  fetchPage: (url: string) => Promise<CrawledPage>
}

interface QueueItem {
  id: string
  url: string
  parentId?: string
}

const allowedProtocols = new Set(['http:', 'https:'])

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim())
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error('文档源只支持 HTTP 或 HTTPS URL')
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function getHostname(input: string): string {
  return new URL(normalizeUrl(input)).hostname
}

export function isSameHostname(input: string, hostname: string): boolean {
  return getHostname(input) === hostname.toLowerCase()
}

export function isAllowedNavigation(input: string, hostname?: string, scopePath = '/'): boolean {
  try {
    normalizeUrl(input)
    return !hostname || isUrlInScope(input, hostname, scopePath)
  } catch {
    return false
  }
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  const root = parse(html)
  const title = root.querySelector('title')?.text.trim() || new URL(pageUrl).hostname
  const language = root.querySelector('html')?.getAttribute('lang')?.trim() || 'und'
  const iconHref = root
    .querySelectorAll('link')
    .find((link) => link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('icon'))
    ?.getAttribute('href')
  const iconUrl =
    (iconHref && resolveLink(iconHref, pageUrl)) ?? new URL('/favicon.ico', pageUrl).toString()
  const links = root
    .querySelectorAll('a')
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => Boolean(href))
    .map((href) => resolveLink(href, pageUrl))
    .filter((url): url is string => Boolean(url))

  root
    .querySelectorAll('script, style, nav, footer, header, aside, noscript')
    .forEach((node) => node.remove())
  const content =
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root
  return {
    title,
    language,
    markdown: htmlToMarkdown(content.innerHTML).trim(),
    links: [...new Set(links)],
    iconUrl
  }
}

function resolveLink(href: string, baseUrl: string): string | undefined {
  try {
    return normalizeUrl(new URL(href, baseUrl).toString())
  } catch {
    return undefined
  }
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxRetries = options.maxRetries ?? 3
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep =
    options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
        if (!isRetryableStatus(response.status) || attempt === maxRetries) return response
        await sleep(retryAfterMs(response.headers.get('retry-after')))
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (attempt === maxRetries) throw error
      await sleep(0)
    }
  }
  throw new Error('抓取任务未返回结果')
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function retryAfterMs(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

export function parseSitemap(
  xml: string,
  baseUrl: string,
  hostname: string,
  limit: number,
  scopePath = '/'
): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const node of parse(xml).querySelectorAll('loc')) {
    try {
      const url = normalizeUrl(new URL(node.text.trim(), baseUrl).toString())
      if (isUrlInScope(url, hostname, scopePath) && !seen.has(url)) {
        urls.push(url)
        seen.add(url)
      }
    } catch {
      continue
    }
    if (urls.length >= limit) break
  }
  return urls
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
  options: Pick<FetchOptions, 'fetchImpl' | 'sleep'> = {},
  scopePath = '/'
): Promise<string[]> {
  try {
    const sitemapUrl = new URL('/sitemap.xml', firstUrl).toString()
    const response = await fetchWithRetry(sitemapUrl, options)
    if (!response.ok) return []
    return parseSitemap(await response.text(), sitemapUrl, hostname, pageLimit + 1, scopePath)
  } catch {
    return []
  }
}

export async function crawlHttpSource(options: HttpCrawlOptions): Promise<CrawlProgress> {
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    options.pageLimit,
    { fetchImpl: options.fetch, sleep: options.sleep },
    options.scopePath
  )
  return runCrawlQueue({
    ...options,
    concurrency: options.concurrency ?? 9,
    fetchMode: 'http',
    sitemapUrls,
    fetchPage: (url) => fetchHttpPage(url, { fetchImpl: options.fetch, sleep: options.sleep })
  })
}

export async function runCrawlQueue(options: CrawlRunnerOptions): Promise<CrawlProgress> {
  const firstUrl = normalizeUrl(options.firstUrl)
  const firstNodeId = options.firstNodeId ?? firstUrl
  const queue: QueueItem[] = []
  const seen = new Set<string>()
  let limitReached = false

  const enqueue = (input: string, parentId?: string, force = false, id?: string): boolean => {
    let url: string
    try {
      url = normalizeUrl(input)
      if (!isUrlInScope(url, options.hostname, options.scopePath) || seen.has(url)) return false
    } catch {
      return false
    }
    if (!force && seen.size >= options.pageLimit) {
      limitReached = true
      return false
    }
    seen.add(url)
    queue.push({ id: id ?? url, url, ...(parentId ? { parentId } : {}) })
    return true
  }

  enqueue(firstUrl, undefined, true, firstNodeId)
  for (const url of options.initialUrls ?? []) enqueue(url, undefined, true)
  for (const url of options.sitemapUrls ?? []) enqueue(url, firstNodeId)

  const progress: CrawlProgress = {
    queued: queue.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitReached
  }
  const failures: CrawlFailure[] = []
  let seedPage = options.seedPage
  let cursor = 0

  const processPage = async (item: QueueItem): Promise<void> => {
    const node: CrawlNode = {
      id: item.id,
      url: item.url,
      title: item.url,
      status: 'running',
      ...(item.parentId ? { parentId: item.parentId } : {})
    }
    options.onProgress?.({ ...progress, node: { ...node } })

    let failure: (CrawlFailure & { missing?: boolean }) | undefined
    try {
      const result = seedPage?.url === item.url ? seedPage : await options.fetchPage(item.url)
      if (result === seedPage) seedPage = undefined
      const page = result.page
      node.url = normalizeUrl(result.url)
      if (!isUrlInScope(node.url, options.hostname, options.scopePath)) {
        failure = {
          url: item.url,
          reason: 'out_of_scope_redirect',
          message: '页面跳转到了文档库范围之外',
          retryable: false,
          redirectUrl: node.url
        }
      }
      if (!failure && (result.status === 404 || result.status === 410)) {
        failure = {
          url: item.url,
          reason: 'not_found',
          message: `页面返回 HTTP ${result.status}`,
          retryable: false,
          statusCode: result.status,
          missing: true
        }
      } else if (!failure && (result.status < 200 || result.status >= 300 || !page)) {
        failure = {
          url: item.url,
          reason: 'http_error',
          message: result.status ? `页面返回 HTTP ${result.status}` : '页面未返回可解析内容',
          retryable:
            result.status === 0 ||
            result.status === 408 ||
            result.status === 429 ||
            result.status >= 500,
          ...(result.status ? { statusCode: result.status } : {})
        }
      } else if (!failure && page) {
        node.title = page.title
        await options.onDocument({
          url: node.url,
          title: page.title,
          language: page.language,
          markdown: page.markdown,
          crawledAt: new Date().toISOString(),
          fetchMode: options.fetchMode
        })
        progress.succeeded += 1
        node.status = 'success'
        for (const link of page.links) {
          if (enqueue(link, item.id)) progress.queued = queue.length
        }
      }
    } catch (error) {
      failure = {
        url: item.url,
        reason: 'request_error',
        message: error instanceof Error ? error.message : '页面请求失败',
        retryable: true
      }
    }

    try {
      if (failure) {
        failures.push(failure)
        progress.failed += 1
        progress.processed += 1
        node.status = 'failed'
        await options.onError?.(failure)
      } else {
        progress.processed += 1
      }
    } finally {
      progress.limitReached = limitReached
      options.onProgress?.({ ...progress, node: { ...node } })
    }
  }

  while (cursor < queue.length) {
    const batch = queue.slice(cursor, cursor + Math.max(1, options.concurrency))
    cursor += batch.length
    await Promise.all(batch.map(processPage))
  }
  const completed = failures.length ? { ...progress, failures } : progress
  options.onProgress?.(completed)
  return completed
}
