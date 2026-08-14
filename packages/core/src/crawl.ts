import { parse } from 'node-html-parser'
import { htmlToMarkdown } from 'mdream'
import { abortableSleep, throwIfAborted } from './abort.js'
import { fetchWithRetry } from './retry.js'
export { fetchWithRetry, isRetryableStatus, retryAfterMs } from './retry.js'
import { discoverSitemapUrls } from './sitemap.js'
export { discoverSitemapUrls, parseSitemap } from './sitemap.js'
import { isUrlInScope } from './scope.js'
import { createPathExclusionMatcher } from './path-exclusion.js'
import { DOCUMENT_SOURCE_LIMITS } from './source-policy.js'
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
import { normalizeUrl } from './url.js'
export { getHostname, isAllowedNavigation, isSameHostname, normalizeUrl } from './url.js'

export type {
  CrawledDocument,
  CrawledPage,
  CrawlDuplicate,
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
  followPageLinks?: boolean
  fetchPage: (url: string) => Promise<CrawledPage>
}

interface QueueItem {
  id: string
  url: string
  parentId?: string
}

interface SlashContentCandidate {
  url: string
  markdown: string
}

const immediateStaticHostnameSuffixes = ['.github.io', '.gitlab.io'] as const

interface ImmediateCrawlOptions {
  concurrency: number
  batchIntervalMs: undefined
  waitIfPaused: undefined
}

/** 已知可整批直取的静态页面不受用户批次节流配置影响。 */
export function immediateCrawlOptions(pageCount: number): ImmediateCrawlOptions {
  return {
    concurrency: Math.max(1, pageCount),
    batchIntervalMs: undefined,
    waitIfPaused: undefined
  }
}

export function isImmediateStaticHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/u, '')
  return immediateStaticHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))
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

export async function fetchHttpPage(
  url: string,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep' | 'signal'> = {}
): Promise<CrawledPage> {
  const response = await fetchWithRetry(url, options)
  throwIfAborted(options.signal)
  const finalUrl = normalizeUrl(response.url || url)
  const body = response.ok ? await response.text() : undefined
  throwIfAborted(options.signal)
  return {
    url: finalUrl,
    status: response.status,
    ...(body === undefined ? {} : { page: parsePage(body, finalUrl) })
  }
}

export async function crawlHttpSource(options: HttpCrawlOptions): Promise<CrawlProgress> {
  const sitemapDiscoveryLimit = options.excludePathPattern
    ? DOCUMENT_SOURCE_LIMITS.pageLimit.max
    : options.pageLimit
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    sitemapDiscoveryLimit,
    {
      fetchImpl: options.fetch,
      maxRetries: options.maxRetries,
      sleep: options.sleep,
      signal: options.signal
    },
    options.scopePath
  )
  const requestPolicy =
    sitemapUrls.length > 0 || isImmediateStaticHostname(options.hostname)
      ? immediateCrawlOptions(options.pageLimit)
      : { concurrency: options.concurrency ?? 9 }
  return runCrawlQueue({
    ...options,
    ...requestPolicy,
    fetchMode: 'http',
    sitemapUrls,
    followPageLinks: sitemapUrls.length === 0,
    fetchPage: (url) =>
      fetchHttpPage(url, {
        fetchImpl: options.fetch,
        maxRetries: options.maxRetries,
        sleep: options.sleep,
        signal: options.signal
      })
  })
}

export async function runCrawlQueue(options: CrawlRunnerOptions): Promise<CrawlProgress> {
  const firstUrl = normalizeUrl(options.firstUrl)
  const firstNodeId = options.firstNodeId ?? firstUrl
  const queue: QueueItem[] = []
  const seen = new Set<string>()
  const slashCandidates = new Map<string, SlashContentCandidate>()
  const isExcluded = createPathExclusionMatcher(options.excludePathPattern)
  let limitReached = false

  const enqueue = (input: string, parentId?: string, id?: string): boolean => {
    let url: string
    try {
      url = normalizeUrl(input)
      if (
        !isUrlInScope(url, options.hostname, options.scopePath) ||
        isExcluded?.(url) ||
        seen.has(url)
      ) {
        return false
      }
    } catch {
      return false
    }
    if (seen.size >= options.pageLimit) {
      limitReached = true
      return false
    }
    seen.add(url)
    queue.push({ id: id ?? url, url, ...(parentId ? { parentId } : {}) })
    return true
  }

  if (isExcluded?.(firstUrl)) throw new Error('起始页面被排除路径正则命中')
  enqueue(firstUrl, undefined, firstNodeId)
  for (const url of options.sitemapUrls ?? []) enqueue(url, firstNodeId)
  for (const url of options.initialUrls ?? []) enqueue(url)

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
    throwIfAborted(options.signal)
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
      } else if (isExcluded?.(node.url)) {
        failure = {
          url: item.url,
          reason: 'out_of_scope_redirect',
          message: '页面跳转到了排除路径',
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
        throwIfAborted(options.signal)
        node.title = page.title
        const slashKey = trailingSlashGroup(item.url)
        const candidate = slashKey ? slashCandidates.get(slashKey) : undefined
        const duplicate = candidate?.markdown === page.markdown
        if (duplicate && candidate) {
          await options.onDuplicate?.({ url: node.url, duplicateOf: candidate.url })
        } else {
          if (slashKey && !candidate) {
            slashCandidates.set(slashKey, { url: node.url, markdown: page.markdown })
          }
          await options.onDocument({
            url: node.url,
            title: page.title,
            language: page.language,
            markdown: page.markdown,
            crawledAt: new Date().toISOString(),
            fetchMode: options.fetchMode
          })
        }
        progress.succeeded += 1
        node.status = 'success'
        if (!duplicate && options.followPageLinks !== false) {
          for (const link of page.links) {
            if (enqueue(link, item.id)) progress.queued = queue.length
          }
        }
      }
    } catch (error) {
      throwIfAborted(options.signal)
      failure = {
        url: item.url,
        reason: 'request_error',
        message: error instanceof Error ? error.message : '页面请求失败',
        retryable: true
      }
    }

    try {
      throwIfAborted(options.signal)
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
    throwIfAborted(options.signal)
    await options.waitIfPaused?.()
    throwIfAborted(options.signal)
    const batch = queue.slice(cursor, cursor + Math.max(1, options.concurrency))
    cursor += batch.length
    await Promise.all(batch.map(processPage))
    throwIfAborted(options.signal)
    if (cursor < queue.length && options.batchIntervalMs) {
      await abortableSleep(options.batchIntervalMs, options.signal, options.sleep ?? defaultSleep)
    }
  }
  const completed = failures.length ? { ...progress, failures } : progress
  options.onProgress?.(completed)
  return completed
}

function trailingSlashGroup(input: string): string | undefined {
  const url = new URL(input)
  if (url.pathname === '/') return undefined
  url.pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  return url.toString()
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
