import { throwIfAborted } from './abort.js'
import { isImmediateStaticHostname } from './crawl.js'
import { renderOpenApiMarkdown } from './openapi-markdown.js'
import { objectValue, stringValue } from './openapi-values.js'
import type {
  CrawlFailure,
  CrawlNode,
  CrawlProgress,
  FetchOptions,
  HttpCrawlOptions
} from './types.js'

export type OpenApiDocument = Record<string, unknown>

export interface OpenApiEntry {
  url: string
  title: string
  document: OpenApiDocument
}

interface OpenApiFetchOptions {
  fetchImpl?: FetchOptions['fetchImpl']
  signal?: AbortSignal
}

interface FetchedJson {
  url: string
  value: unknown
}

interface ConfigTarget {
  url: string
  name?: string
}

const candidatePaths = [
  '/openapi.json',
  '/v3/api-docs/swagger-config',
  '/v3/api-docs',
  '/swagger-resources',
  '/v2/api-docs'
] as const

const operationPagePatterns = [
  /\/(?:docs|redoc)\/?$/u,
  /\/doc\.html$/u,
  /\/swagger(?:-ui)?(?:\/index\.html|\.html)?\/?$/u,
  /\/(?:v[23]\/api-docs|api-docs)(?:\/swagger-config)?\/?$/u,
  /\/swagger-resources\/?$/u,
  /\/openapi(?:\.json)?\/?$/u
] as const

/** URL 特征只决定是否探测，最终仍以返回的 JSON 结构为准。 */
export function looksLikeOpenApiDocumentationUrl(input: string): boolean {
  try {
    const pathname = new URL(input).pathname.toLowerCase()
    return operationPagePatterns.some((pattern) => pattern.test(pathname))
  } catch {
    return false
  }
}

/** GitHub/GitLab Pages 之后、普通网页之前发现同 hostname 的 OpenAPI JSON。 */
export async function discoverOpenApiEntries(
  firstUrl: string,
  hostname: string,
  options: OpenApiFetchOptions = {}
): Promise<OpenApiEntry[]> {
  if (isImmediateStaticHostname(hostname) || !looksLikeOpenApiDocumentationUrl(firstUrl)) {
    return []
  }
  throwIfAborted(options.signal)

  const candidates = uniqueUrls([
    withoutHash(firstUrl),
    ...candidatePaths.map((path) => new URL(path, firstUrl).toString())
  ])
  const firstBatch = await fetchJsonBatch(candidates, hostname, options)
  const entries = new Map<string, OpenApiEntry>()
  const targets: ConfigTarget[] = []

  for (const candidate of firstBatch) {
    throwIfAborted(options.signal)
    if (isOpenApiDocument(candidate.value)) {
      addEntry(entries, candidate)
      continue
    }
    targets.push(...extractConfigTargets(candidate.value, candidate.url, hostname))
  }

  const configNames = new Map(targets.map((target) => [target.url, target.name]))
  const configBatch = await fetchJsonBatch(
    uniqueUrls(targets.map((target) => target.url)),
    hostname,
    options
  )
  for (const candidate of configBatch) {
    throwIfAborted(options.signal)
    if (isOpenApiDocument(candidate.value)) {
      addEntry(entries, candidate, configNames.get(candidate.url))
    }
  }

  return [...entries.values()]
}

/** OpenAPI 规范是权威来源；转换后不再递归发现网页。 */
export async function crawlOpenApiSource(
  options: HttpCrawlOptions,
  entries: readonly OpenApiEntry[]
): Promise<CrawlProgress> {
  const selected = entries.slice(0, options.pageLimit)
  if (!selected.length) throw new Error('没有可收录的 OpenAPI 文档')

  const progress: CrawlProgress = {
    queued: selected.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitReached: entries.length > selected.length
  }
  const failures: CrawlFailure[] = []
  const rootId = options.firstNodeId ?? options.firstUrl

  for (const [index, entry] of selected.entries()) {
    throwIfAborted(options.signal)
    await options.waitIfPaused?.()
    throwIfAborted(options.signal)
    const node: CrawlNode = {
      id: index === 0 ? rootId : entry.url,
      url: entry.url,
      title: entry.title,
      status: 'running',
      ...(index > 0 ? { parentId: rootId } : {})
    }
    options.onProgress?.({ ...progress, node: { ...node } })
    try {
      throwIfAborted(options.signal)
      await options.onDocument({
        url: entry.url,
        title: entry.title,
        language: 'und',
        markdown: renderOpenApiMarkdown(entry.document),
        crawledAt: new Date().toISOString(),
        fetchMode: 'http'
      })
      progress.succeeded += 1
      node.status = 'success'
    } catch (error) {
      throwIfAborted(options.signal)
      const failure: CrawlFailure = {
        url: entry.url,
        reason: 'request_error',
        message: error instanceof Error ? error.message : 'OpenAPI 文档保存失败',
        retryable: false
      }
      failures.push(failure)
      progress.failed += 1
      node.status = 'failed'
      await options.onError?.(failure)
    }
    progress.processed += 1
    options.onProgress?.({ ...progress, node: { ...node } })
  }

  const completed = failures.length ? { ...progress, failures } : progress
  options.onProgress?.(completed)
  return completed
}

export function isOpenApiDocument(input: unknown): input is OpenApiDocument {
  const document = objectValue(input)
  if (!document || !objectValue(document.info) || !objectValue(document.paths)) return false
  return typeof document.openapi === 'string' || typeof document.swagger === 'string'
}

function addEntry(
  entries: Map<string, OpenApiEntry>,
  candidate: FetchedJson,
  groupName?: string
): void {
  if (!isOpenApiDocument(candidate.value)) return
  const info = objectValue(candidate.value.info)
  const productTitle = stringValue(info?.title) || new URL(candidate.url).hostname
  const title =
    groupName && groupName !== productTitle ? `${productTitle} · ${groupName}` : productTitle
  entries.set(candidate.url, { url: candidate.url, title, document: candidate.value })
}

function extractConfigTargets(input: unknown, baseUrl: string, hostname: string): ConfigTarget[] {
  const rawTargets: Array<{ url?: unknown; name?: unknown }> = []
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = objectValue(item)
      if (value) rawTargets.push({ url: value.location ?? value.url, name: value.name })
    }
  } else {
    const value = objectValue(input)
    if (!value) return []
    if (typeof value.url === 'string') rawTargets.push({ url: value.url })
    if (Array.isArray(value.urls)) {
      for (const item of value.urls) {
        const target = objectValue(item)
        if (target) rawTargets.push({ url: target.url, name: target.name })
      }
    }
  }

  const targets: ConfigTarget[] = []
  for (const target of rawTargets) {
    if (typeof target.url !== 'string') continue
    try {
      const url = withoutHash(new URL(target.url, baseUrl).toString())
      if (new URL(url).hostname.toLowerCase() !== hostname.toLowerCase()) continue
      targets.push({ url, ...(typeof target.name === 'string' ? { name: target.name } : {}) })
    } catch {
      // 单个无效分组地址不影响其他规范。
    }
  }
  return targets
}

async function fetchJsonBatch(
  urls: readonly string[],
  hostname: string,
  options: OpenApiFetchOptions
): Promise<FetchedJson[]> {
  const settled = await Promise.allSettled(urls.map((url) => fetchJson(url, options)))
  throwIfAborted(options.signal)
  return settled.flatMap((result) => {
    if (result.status !== 'fulfilled' || !result.value) return []
    try {
      return new URL(result.value.url).hostname.toLowerCase() === hostname.toLowerCase()
        ? [result.value]
        : []
    } catch {
      return []
    }
  })
}

async function fetchJson(
  url: string,
  options: OpenApiFetchOptions
): Promise<FetchedJson | undefined> {
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      redirect: 'follow',
      signal: options.signal,
      headers: { accept: 'application/json, application/vnd.oai.openapi+json' }
    })
    if (!response.ok) return undefined
    const value: unknown = JSON.parse(await response.text())
    return { url: withoutHash(response.url || url), value }
  } catch {
    throwIfAborted(options.signal)
    return undefined
  }
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)]
}

function withoutHash(input: string): string {
  const url = new URL(input)
  url.hash = ''
  return url.toString()
}
