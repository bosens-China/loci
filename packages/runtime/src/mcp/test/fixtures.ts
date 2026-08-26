import type {
  CloudCatalogItem,
  CrawlFailure,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'
import type { LociMcpServices } from '../server.js'

export const source: DocumentSource = {
  id: 'lib-vue',
  name: 'Vue 中文文档',
  url: 'https://cn.vuejs.org/guide/',
  mode: 'http',
  status: 'healthy',
  pages: 1,
  contentSize: Buffer.byteLength('# 响应式基础'),
  pageLimit: 1000,
  scopePath: '/',
  lastUpdated: '刚刚',
  schedule: null,
  httpConcurrency: null,
  browserConcurrency: null,
  iconUrl: 'https://cn.vuejs.org/logo.svg',
  cloud: null,
  kind: 'web',
  githubArchiveLimitMb: null,
  githubMarkdownLimitMb: null,
  githubDefaultBranch: null,
  githubRevision: null,
  discoveryMode: 'site',
  resolvedDiscovery: 'pages',
  reviewGoal: null
}

export const document: DocumentRecord = {
  id: 'file-reactivity',
  sourceId: source.id,
  sourceName: source.name,
  title: '响应式基础',
  url: 'https://cn.vuejs.org/guide/essentials/reactivity-fundamentals',
  folder: 'guide / essentials',
  language: 'zh-CN',
  updatedAt: '刚刚',
  content: `# 响应式基础\n\n${'读取属性时进行依赖追踪。'.repeat(180)}\n\n## 注意事项\n\n避免直接替换对象。`
}

export const completedProgress: CrawlProgress = {
  queued: 1,
  processed: 1,
  succeeded: 1,
  failed: 0,
  limitReached: false
}

export const runId = 'run-vue-1'

export const crawlFailures: CrawlFailure[] = [
  {
    url: 'https://cn.vuejs.org/missing.md',
    reason: 'not_found',
    message: 'HTTP 404',
    retryable: false,
    statusCode: 404
  }
]

export const cloudLibrary: CloudCatalogItem = {
  id: 'cloud-vue',
  name: 'Vue 云端文档',
  url: source.url,
  revision: 'revision-1',
  pages: 1,
  contentSize: 1024,
  lastCrawledAt: '2026-08-03T00:00:00.000Z',
  publishedAt: '2026-08-03T00:00:00.000Z',
  localSourceId: null,
  localRevision: null,
  autoSync: false,
  updateAvailable: false
}

export function createServices(): LociMcpServices {
  return {
    listSources: () => [source],
    listDocuments: () => [document],
    searchDocuments: () => [document],
    createSource: () => source,
    inspectSource: async ({ url, scopePath = '/' }) => ({
      url,
      hostname: new URL(url).hostname,
      kind: 'web',
      scopePath,
      discovery: 'sitemap',
      estimateKind: 'exact',
      estimatedPages: 1,
      discoveredPages: 1,
      excludedPages: 0,
      exceedsHardLimit: false,
      hardPageLimit: 10_000,
      pathGroups: [{ path: '/guide', pages: 1 }]
    }),
    updateSource: () => source,
    crawlSource: async (_id, onProgress) => {
      onProgress?.({ ...completedProgress, processed: 0, succeeded: 0 })
      onProgress?.(completedProgress)
      return completedProgress
    },
    fetchPages: async (_id, urls) => ({
      runId,
      items: urls.map((url) => ({ url, status: 'unchanged' as const })),
      progress: completedProgress
    }),
    startUrlReview: async () => {
      throw new Error('fixture 未启用 URL 审查')
    },
    submitUrlReview: async () => {
      throw new Error('fixture 未启用 URL 审查')
    },
    getUrlReview: () => undefined,
    getActiveUrlReview: () => undefined,
    cancelUrlReview: () => false,
    deleteSource: () => undefined,
    isCrawling: () => false,
    getCrawlState: () => ({ ...runningState(), progress: completedProgress, running: false }),
    getLatestCrawlRunId: () => runId,
    getCrawlRunLibraryId: (id) => (id === runId ? source.id : undefined),
    listCrawlFailures: (id) => (id === runId ? crawlFailures : []),
    listCloudLibraries: async () => [cloudLibrary],
    pullCloudLibrary: async () => ({ source, updated: true, documents: source.pages })
  }
}

export function runningState(): CrawlRunState {
  return {
    sourceId: source.id,
    progress: { ...completedProgress, processed: 0, succeeded: 0 },
    nodes: [],
    error: null,
    running: true,
    paused: false
  }
}

export function getFirstFile(value: unknown): {
  content: string
  offset: number
  next_offset: number
} {
  if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files)) {
    throw new Error('missing files')
  }
  const file: unknown = value.files[0]
  if (!file || typeof file !== 'object') throw new Error('missing first file')
  const record = file as Record<string, unknown>
  if (
    typeof record.content !== 'string' ||
    typeof record.offset !== 'number' ||
    typeof record.next_offset !== 'number'
  )
    throw new Error('invalid first file')
  return { content: record.content, offset: record.offset, next_offset: record.next_offset }
}
