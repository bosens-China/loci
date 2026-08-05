import { fromMarkdown } from 'mdast-util-from-markdown'
import { fetchWithRetry, normalizeUrl, parsePage, runCrawlQueue } from './crawl.js'
import { isUrlInScope } from './scope.js'
import type { CrawledPage, CrawlProgress, FetchOptions, HttpCrawlOptions } from './types.js'

export interface LlmsEntry {
  title: string
  url: string
}

interface MarkdownNode {
  type: string
  value?: unknown
  url?: unknown
  children?: unknown
}

function markdownNode(input: unknown): MarkdownNode | undefined {
  if (!input || typeof input !== 'object' || !('type' in input)) return undefined
  const type = Reflect.get(input, 'type')
  return typeof type === 'string' ? (input as MarkdownNode) : undefined
}

function nodeText(input: unknown): string {
  const node = markdownNode(input)
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  if (!Array.isArray(node.children)) return ''
  return node.children.map(nodeText).join('')
}

/** 按 Markdown 语义提取列表项里的链接，忽略说明正文中的普通链接。 */
export function parseLlmsTxt(
  markdown: string,
  baseUrl: string,
  hostname: string,
  scopePath = '/',
  limit = Number.POSITIVE_INFINITY
): LlmsEntry[] {
  const entries: LlmsEntry[] = []
  const seen = new Set<string>()

  const visit = (input: unknown, insideListItem = false): void => {
    const node = markdownNode(input)
    if (!node || entries.length >= limit) return
    const isListItem = insideListItem || node.type === 'listItem'
    if (node.type === 'link' && isListItem && typeof node.url === 'string') {
      try {
        const url = normalizeUrl(new URL(node.url, baseUrl).toString())
        if (isUrlInScope(url, hostname, scopePath) && !seen.has(url)) {
          entries.push({ title: nodeText(node).trim() || new URL(url).pathname, url })
          seen.add(url)
        }
      } catch {
        // 单个无效链接不影响其余清单。
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, isListItem)
    }
  }

  visit(fromMarkdown(markdown))
  return entries
}

export async function discoverLlmsEntries(
  firstUrl: string,
  hostname: string,
  scopePath: string,
  pageLimit: number,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep'> = {}
): Promise<LlmsEntry[]> {
  try {
    const llmsUrl = new URL('/llms.txt', firstUrl).toString()
    const response = await fetchWithRetry(llmsUrl, options)
    if (!response.ok) return []
    const manifestUrl = normalizeUrl(response.url || llmsUrl)
    const entries = parseLlmsTxt(await response.text(), manifestUrl, hostname, scopePath, pageLimit)
    return expandLlmsManifests(entries, hostname, scopePath, pageLimit, options, {
      depth: 0,
      visited: new Set([manifestUrl])
    })
  } catch {
    return []
  }
}

interface ManifestExpansionState {
  depth: number
  visited: Set<string>
}

/** 展开站点级 llms.txt 指向的库级清单，避免把清单本身误存成正文。 */
async function expandLlmsManifests(
  entries: readonly LlmsEntry[],
  hostname: string,
  scopePath: string,
  limit: number,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep'>,
  state: ManifestExpansionState
): Promise<LlmsEntry[]> {
  const expanded: LlmsEntry[] = []
  for (const entry of entries) {
    if (expanded.length >= limit) break
    if (!isLlmsManifest(entry.url) || state.depth >= 3 || state.visited.has(entry.url)) {
      if (!state.visited.has(entry.url)) expanded.push(entry)
      continue
    }

    state.visited.add(entry.url)
    try {
      const response = await fetchWithRetry(entry.url, options)
      if (!response.ok) {
        expanded.push(entry)
        continue
      }
      const manifestUrl = normalizeUrl(response.url || entry.url)
      state.visited.add(manifestUrl)
      const nestedEntries = parseLlmsTxt(
        await response.text(),
        manifestUrl,
        hostname,
        scopePath,
        Number.POSITIVE_INFINITY
      )
      if (!nestedEntries.length) {
        expanded.push(entry)
        continue
      }
      expanded.push(
        ...(await expandLlmsManifests(
          nestedEntries,
          hostname,
          scopePath,
          limit - expanded.length,
          options,
          { depth: state.depth + 1, visited: state.visited }
        ))
      )
    } catch {
      expanded.push(entry)
    }
  }
  return expanded.slice(0, limit)
}

function isLlmsManifest(input: string): boolean {
  return new URL(input).pathname.endsWith('/llms.txt')
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .trim()
}

export async function fetchMarkdownPage(
  entry: LlmsEntry,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep'> = {}
): Promise<CrawledPage> {
  const response = await fetchWithRetry(entry.url, options)
  const url = normalizeUrl(response.url || entry.url)
  if (!response.ok) return { url, status: response.status }
  const body = await response.text()
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('text/html') && /^\s*<!?(?:doctype|html)\b/iu.test(body)) {
    return { url, status: response.status, page: parsePage(body, url) }
  }
  return {
    url,
    status: response.status,
    page: {
      title: entry.title,
      language: 'und',
      markdown: normalizeMarkdown(body),
      links: []
    }
  }
}

/** llms.txt 是权威清单；只抓取清单中的 Markdown，不再递归发现页面。 */
export function crawlLlmsSource(
  options: HttpCrawlOptions,
  entries: readonly LlmsEntry[]
): Promise<CrawlProgress> {
  const selectedEntries = entries.slice(0, options.pageLimit)
  const first = selectedEntries[0]
  if (!first) throw new Error('llms.txt 没有可收录的页面')
  const entryByUrl = new Map(selectedEntries.map((entry) => [entry.url, entry]))
  return runCrawlQueue({
    ...options,
    firstUrl: first.url,
    firstNodeId: options.firstNodeId ?? options.firstUrl,
    initialUrls: [],
    concurrency: options.concurrency ?? 9,
    fetchMode: 'http',
    sitemapUrls: selectedEntries.slice(1).map((entry) => entry.url),
    fetchPage: (url) =>
      fetchMarkdownPage(entryByUrl.get(url) ?? { title: new URL(url).pathname, url }, {
        fetchImpl: options.fetch,
        maxRetries: options.maxRetries,
        sleep: options.sleep
      })
  })
}
