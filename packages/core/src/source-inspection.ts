import {
  DOCUMENT_SOURCE_LIMITS,
  createPathExclusionMatcher,
  parseGithubRepositoryUrl
} from '@loci/shared'
import { readGithubRepositoryMetadata } from './github-download.js'
import { discoverLlmsEntries } from './llms.js'
import { discoverOpenApiEntries } from './openapi.js'
import { discoverSitemapUrls } from './sitemap.js'
import { normalizeScopePath } from './scope.js'
import { getHostname, normalizeUrl } from './url.js'

export type SourceInspectionDiscovery = 'github' | 'llms' | 'openapi' | 'sitemap' | 'unknown'
export type SourceEstimateKind = 'exact' | 'lower_bound' | 'unknown'

export interface SourcePathGroup {
  path: string
  pages: number
}

export interface SourceInspection {
  url: string
  hostname: string
  kind: 'web' | 'github'
  scopePath: string
  discovery: SourceInspectionDiscovery
  estimateKind: SourceEstimateKind
  estimatedPages: number | null
  discoveredPages: number
  excludedPages: number
  exceedsHardLimit: boolean
  hardPageLimit: number
  pathGroups: SourcePathGroup[]
  githubDefaultBranch?: string
  githubRevision?: string
}

export interface InspectSourceOptions {
  url: string
  scopePath?: string
  excludePathPattern?: string | null
  fetch?: typeof fetch
  signal?: AbortSignal
}

/**
 * 只读取轻量清单和仓库元数据，给调用方提供抓取规划依据；
 * 普通链接递归站点返回 unknown，不为估算提前完整抓取。
 */
export async function inspectSource(options: InspectSourceOptions): Promise<SourceInspection> {
  const hardPageLimit = DOCUMENT_SOURCE_LIMITS.pageLimit.max
  const repository = parseGithubRepositoryUrl(options.url)
  if (repository) {
    const metadata = await readGithubRepositoryMetadata(
      repository,
      options.fetch ?? fetch,
      options.signal
    )
    return {
      url: repository.url,
      hostname: 'github.com',
      kind: 'github',
      scopePath: '/',
      discovery: 'github',
      estimateKind: 'unknown',
      estimatedPages: null,
      discoveredPages: 0,
      excludedPages: 0,
      exceedsHardLimit: false,
      hardPageLimit,
      pathGroups: [],
      githubDefaultBranch: metadata.defaultBranch,
      githubRevision: metadata.revision
    }
  }

  const url = normalizeUrl(options.url)
  const hostname = getHostname(url)
  const scopePath = normalizeScopePath(options.scopePath ?? '/')
  const fetchImpl = options.fetch ?? fetch
  const llms = await discoverLlmsEntries(url, hostname, scopePath, hardPageLimit + 1, {
    fetchImpl,
    signal: options.signal
  })
  if (llms.length) {
    return inspectCandidates(options, url, hostname, scopePath, 'llms', llms.map(itemUrl))
  }

  const openapi = await discoverOpenApiEntries(url, hostname, {
    fetchImpl,
    signal: options.signal
  })
  if (openapi.length) {
    return inspectCandidates(options, url, hostname, scopePath, 'openapi', openapi.map(itemUrl))
  }

  const sitemap = await discoverSitemapUrls(
    url,
    hostname,
    hardPageLimit,
    { fetchImpl, signal: options.signal },
    scopePath
  )
  if (sitemap.length) {
    return inspectCandidates(options, url, hostname, scopePath, 'sitemap', sitemap)
  }

  return {
    url,
    hostname,
    kind: 'web',
    scopePath,
    discovery: 'unknown',
    estimateKind: 'unknown',
    estimatedPages: null,
    discoveredPages: 0,
    excludedPages: 0,
    exceedsHardLimit: false,
    hardPageLimit,
    pathGroups: []
  }
}

function inspectCandidates(
  options: InspectSourceOptions,
  url: string,
  hostname: string,
  scopePath: string,
  discovery: Exclude<SourceInspectionDiscovery, 'github' | 'unknown'>,
  candidates: string[]
): SourceInspection {
  const hardPageLimit = DOCUMENT_SOURCE_LIMITS.pageLimit.max
  const exceedsHardLimit = candidates.length > hardPageLimit
  const visible = candidates.slice(0, hardPageLimit + 1)
  const isExcluded = createPathExclusionMatcher(options.excludePathPattern)
  const excludedPages = isExcluded ? visible.filter(isExcluded).length : 0
  return {
    url,
    hostname,
    kind: 'web',
    scopePath,
    discovery,
    estimateKind: exceedsHardLimit ? 'lower_bound' : 'exact',
    estimatedPages: visible.length - excludedPages,
    discoveredPages: visible.length,
    excludedPages,
    exceedsHardLimit,
    hardPageLimit,
    pathGroups: groupPaths(visible, scopePath)
  }
}

function itemUrl(item: { url: string }): string {
  return item.url
}

/** 只返回当前范围的下一层路径；调用方可带更窄 scope 再检查下一层。 */
function groupPaths(urls: readonly string[], scopePath: string): SourcePathGroup[] {
  const scopeSegments = segments(scopePath)
  const counts = new Map<string, number>()
  for (const input of urls) {
    const pathSegments = segments(new URL(input).pathname)
    const length = Math.min(pathSegments.length, scopeSegments.length + 1)
    const path = length ? `/${pathSegments.slice(0, length).join('/')}` : '/'
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([path, pages]) => ({ path, pages }))
    .sort((left, right) => right.pages - left.pages || left.path.localeCompare(right.path))
    .slice(0, 25)
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}
