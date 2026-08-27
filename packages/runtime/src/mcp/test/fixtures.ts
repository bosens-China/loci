import type {
  CloudCatalogItem,
  CloudLibrary,
  CloudSyncJob,
  CrawlFailure,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource,
  LocalJob
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

export const localJob: LocalJob = {
  id: 'task-vue-1',
  kind: 'source_sync',
  resourceKey: `source_sync:${source.id}`,
  sourceId: source.id,
  hostname: 'cn.vuejs.org',
  trigger: 'mcp',
  status: 'pending',
  priority: 0,
  paused: false,
  pauseRequested: false,
  stopRequested: false,
  partial: false,
  contentBytes: 0,
  remainingCount: 0,
  scheduledAt: '2026-08-03T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  heartbeatAt: null,
  attemptCount: 0,
  cancelRequested: false,
  error: null,
  result: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z'
}

export const serverJob: CloudSyncJob = {
  id: 'server-task-1',
  libraryId: 'server-library',
  hostname: 'cn.vuejs.org',
  status: 'queued',
  priority: 0,
  paused: false,
  pauseRequested: false,
  stopRequested: false,
  partial: false,
  contentBytes: 0,
  remainingCount: 0,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  finishedAt: null,
  progress: null,
  failures: [],
  error: null
}

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

export const serverLibrary: CloudLibrary = {
  id: 'server-library',
  name: source.name,
  url: source.url,
  hostname: new URL(source.url).hostname,
  scopePath: source.scopePath,
  pageLimit: source.pageLimit,
  schedule: null,
  pages: source.pages,
  lastCrawledAt: source.lastUpdated,
  lastError: null,
  revision: 'sha256:test',
  publishedAt: '2026-08-27T00:00:00.000Z'
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
    listLocalJobs: () => [localJob],
    getLocalJob: (id) => (id === localJob.id ? localJob : undefined),
    pauseLocalJob: (id) => (id === localJob.id ? { ...localJob, paused: true } : undefined),
    resumeLocalJob: (id) => (id === localJob.id ? localJob : undefined),
    stopLocalJob: (id) =>
      id === localJob.id ? { ...localJob, status: 'completed', partial: true } : undefined,
    cancelLocalJob: (id) =>
      id === localJob.id ? { ...localJob, status: 'cancelled', cancelRequested: true } : undefined,
    setLocalJobPriority: (id, priority) =>
      id === localJob.id ? { ...localJob, priority } : undefined,
    pauseLocalJobs: () => 1,
    resumeLocalJobs: () => 1,
    listOperationLogs: () => ({ total: 0, items: [] }),
    listHostnameCrawlPolicies: () => [],
    saveHostnameCrawlPolicy: (input) => ({ ...input, updatedAt: '2026-08-27T00:00:00.000Z' }),
    deleteHostnameCrawlPolicy: () => true,
    listServerHostnamePolicies: async () => [],
    saveServerHostnamePolicy: async (input) => ({
      ...input,
      updatedAt: '2026-08-27T00:00:00.000Z'
    }),
    deleteServerHostnamePolicy: async () => undefined,
    listCloudLibraries: async () => [cloudLibrary],
    getCloudLibraryTree: async () => [{ id: document.id, title: document.title, readable: true }],
    readCloudLibraryFile: async () => ({
      id: document.id,
      libraryId: cloudLibrary.id,
      title: document.title,
      url: document.url,
      path: '/guide',
      language: document.language,
      updatedAt: document.updatedAt,
      content: document.content,
      offset: 0,
      totalChars: document.content.length,
      truncated: false
    }),
    pullCloudLibrary: async () => ({ source, updated: true, documents: source.pages }),
    publishLocalLibrary: async () => ({
      library: serverLibrary,
      revision: 'sha256:test',
      publishedAt: '2026-08-27T00:00:00.000Z',
      pages: source.pages,
      contentSize: source.contentSize,
      reused: false
    }),
    moveDocumentsToNewSource: () => ({
      operationId: 'move-1',
      target: source,
      moved: 1,
      deletedSourceIds: [],
      reused: false
    }),
    listServerTasks: async () => [serverJob],
    controlServerTask: async (id, action) => ({
      ...serverJob,
      id,
      paused: action === 'pause',
      status: action === 'cancel' ? 'canceled' : serverJob.status
    }),
    setServerTaskPriority: async (id, priority) => ({ ...serverJob, id, priority }),
    controlServerTasks: async () => 1,
    listServerLibraries: async () => [serverLibrary],
    createServerLibrary: async () => serverLibrary,
    updateServerLibrary: async () => serverLibrary,
    deleteServerLibrary: async () => undefined,
    syncServerLibraries: async () => [serverJob]
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
