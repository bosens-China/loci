import { parse } from 'node-html-parser'
import { throwIfAborted } from './abort.js'
import { fetchWithRetry } from './retry.js'
import { isUrlInScope } from './scope.js'
import type { FetchOptions } from './types.js'
import { isSameHostname, normalizeUrl } from './url.js'

interface SitemapDocument {
  kind: 'index' | 'urlset'
  urls: string[]
}

const maximumSitemapDepth = 3

/** 解析单个 URL 集；Sitemap 索引由发现流程继续展开。 */
export function parseSitemap(
  xml: string,
  baseUrl: string,
  hostname: string,
  limit: number,
  scopePath = '/'
): string[] {
  const document = parseSitemapDocument(xml, baseUrl)
  if (document?.kind !== 'urlset') return []
  return filterPageUrls(document.urls, hostname, scopePath, limit)
}

/** 从根 Sitemap 或 Sitemap 索引中发现范围内页面。空结果表示清单不可作为权威来源。 */
export async function discoverSitemapUrls(
  firstUrl: string,
  hostname: string,
  pageLimit: number,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep' | 'signal'> = {},
  scopePath = '/'
): Promise<string[]> {
  const urls: string[] = []
  const seenPages = new Set<string>()
  const visitedSitemaps = new Set<string>()
  const limit = pageLimit + 1

  const visit = async (input: string, depth: number): Promise<void> => {
    if (depth > maximumSitemapDepth || urls.length >= limit) return
    const sitemapUrl = normalizeUrl(input)
    if (visitedSitemaps.has(sitemapUrl) || !isSameHostname(sitemapUrl, hostname)) return
    visitedSitemaps.add(sitemapUrl)

    let response: Response
    try {
      response = await fetchWithRetry(sitemapUrl, options)
    } catch {
      throwIfAborted(options.signal)
      return
    }
    if (!response.ok) return
    const document = parseSitemapDocument(await response.text(), response.url || sitemapUrl)
    if (!document) return
    if (document.kind === 'urlset') {
      for (const url of filterPageUrls(document.urls, hostname, scopePath, limit)) {
        if (seenPages.has(url)) continue
        seenPages.add(url)
        urls.push(url)
        if (urls.length >= limit) break
      }
      return
    }
    for (const child of document.urls) {
      await visit(child, depth + 1)
      if (urls.length >= limit) break
    }
  }

  await visit(new URL('/sitemap.xml', firstUrl).toString(), 0)
  return urls
}

function parseSitemapDocument(xml: string, baseUrl: string): SitemapDocument | undefined {
  const root = parse(xml)
  const container = root.querySelector('urlset') ?? root.querySelector('sitemapindex')
  if (!container) return undefined
  const kind = container.tagName.toLowerCase() === 'sitemapindex' ? 'index' : 'urlset'
  const urls: string[] = []
  for (const node of container.querySelectorAll('loc')) {
    try {
      urls.push(normalizeUrl(new URL(node.text.trim(), baseUrl).toString()))
    } catch {
      // 单个无效地址不影响同一清单中的其他条目。
    }
  }
  return { kind, urls }
}

function filterPageUrls(
  inputs: readonly string[],
  hostname: string,
  scopePath: string,
  limit: number
): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const url of inputs) {
    if (isUrlInScope(url, hostname, scopePath) && !seen.has(url)) {
      urls.push(url)
      seen.add(url)
    }
    if (urls.length >= limit) break
  }
  return urls
}
