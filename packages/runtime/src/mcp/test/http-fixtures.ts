import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type {
  CloudCatalogItem,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'
import type { McpHttpServer } from '../http.js'
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
  githubRevision: null
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
    crawlSource: async (_id, onProgress) => {
      onProgress?.({ ...completedProgress, processed: 0, succeeded: 0 })
      onProgress?.(completedProgress)
      return completedProgress
    },
    deleteSource: () => undefined,
    isCrawling: () => false,
    getCrawlState: () => ({ ...runningState(), progress: completedProgress, running: false }),
    listCloudLibraries: async () => [cloudLibrary],
    pullCloudLibrary: async () => ({ source, updated: true, documents: source.pages })
  }
}

export async function connect(server: McpHttpServer): Promise<Client> {
  const connected = new Client({ name: 'loci-test', version: '1.0.0' })
  await connected.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)))
  return connected
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
