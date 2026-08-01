import type { CrawlFailure, CrawlNode, CrawlProgress } from '../../shared/api'
import type { ParsedPage } from './content'
import { isSameHostname, normalizeUrl } from './url'

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

export interface CrawlRunnerOptions {
  firstUrl: string
  firstNodeId?: string
  hostname: string
  pageLimit: number
  concurrency: number
  fetchMode: CrawledDocument['fetchMode']
  initialUrls?: readonly string[]
  sitemapUrls?: readonly string[]
  seedPage?: CrawledPage
  fetchPage: (url: string) => Promise<CrawledPage>
  onDocument: (document: CrawledDocument) => Promise<void> | void
  onError?: (error: CrawlFailure & { missing?: boolean }) => Promise<void> | void
  onProgress?: (progress: CrawlProgress) => void
}

interface QueueItem {
  id: string
  url: string
  parentId?: string
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
      if (!isSameHostname(url, options.hostname) || seen.has(url)) return false
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
      if (!isSameHostname(node.url, options.hostname)) {
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
