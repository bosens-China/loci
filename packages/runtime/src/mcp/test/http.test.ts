import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CloudCatalogItem,
  CreateSourceInput,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'
import { isLociMcpAvailable, startMcpHttpServer, type McpHttpServer } from '../http'
import type { LociMcpServices } from '../server'

const source: DocumentSource = {
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
  cloud: null
}

const document: DocumentRecord = {
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

const completedProgress: CrawlProgress = {
  queued: 1,
  processed: 1,
  succeeded: 1,
  failed: 0,
  limitReached: false
}

const cloudLibrary: CloudCatalogItem = {
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

describe('MCP HTTP server', () => {
  let httpServer: McpHttpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await httpServer?.close()
  })

  it('supports the directory-first workflow, section reading and progress notifications', async () => {
    httpServer = await startMcpHttpServer(0, createServices())
    expect(await isLociMcpAvailable(httpServer.port)).toBe(true)
    client = await connect(httpServer)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'loci_add_library',
      'loci_sync_libraries',
      'loci_get_sync_status',
      'loci_list_libraries',
      'loci_list_cloud_libraries',
      'loci_pull_cloud_library',
      'loci_get_library_tree',
      'loci_read_files',
      'loci_search_files',
      'loci_delete_library'
    ])
    expect(tools.tools.every((tool) => tool.outputSchema)).toBe(true)

    const listed = await client.callTool({ name: 'loci_list_libraries', arguments: {} })
    expect(listed.structuredContent).toMatchObject({ total_count: 1 })
    expect(listed.content[0]).toMatchObject({ type: 'text' })

    const added = await client.callTool({
      name: 'loci_add_library',
      arguments: { url: source.url }
    })
    expect(added.structuredContent).toMatchObject({ created: false, status: 'idle' })

    const cloud = await client.callTool({
      name: 'loci_list_cloud_libraries',
      arguments: { query: 'Vue' }
    })
    expect(cloud.structuredContent).toMatchObject({
      total_count: 1,
      items: [{ id: cloudLibrary.id, content_size: 1024, local_source_id: null }]
    })

    const pulled = await client.callTool({
      name: 'loci_pull_cloud_library',
      arguments: { library_id: cloudLibrary.id }
    })
    expect(pulled.structuredContent).toMatchObject({
      updated: true,
      documents: 1,
      library: { id: source.id }
    })

    const tree = await client.callTool({
      name: 'loci_get_library_tree',
      arguments: { library_id: source.id, depth: 2 }
    })
    expect(tree.structuredContent).toMatchObject({
      languages: ['zh-CN'],
      nodes: [{ id: `folder:${source.id}:guide`, children: [{ title: 'essentials' }] }]
    })
    const expanded = await client.callTool({
      name: 'loci_get_library_tree',
      arguments: { library_id: source.id, parent_id: `folder:${source.id}:guide/essentials` }
    })
    expect(expanded.structuredContent).toMatchObject({
      languages: ['zh-CN'],
      nodes: [{ id: document.id, readable: true, language: 'zh-CN' }]
    })

    const searched = await client.callTool({
      name: 'loci_search_files',
      arguments: { queries: ['响应式基础', '依赖追踪'] }
    })
    expect(searched.structuredContent).toMatchObject({
      results: [
        {
          query: '响应式基础',
          items: [{ file_id: document.id, section_id: `${document.id}:section:0` }]
        },
        {
          query: '依赖追踪',
          items: [{ file_id: document.id }]
        }
      ]
    })

    const firstRead = await client.callTool({
      name: 'loci_read_files',
      arguments: {
        file_ids: [document.id],
        section_id: `${document.id}:section:0`,
        max_chars_per_file: 1000
      }
    })
    expect(firstRead.structuredContent).toMatchObject({
      files: [{ id: document.id, language: 'zh-CN', offset: 0, truncated: true }]
    })
    expect(firstRead.content[0]).toMatchObject({ type: 'text' })
    const firstFile = getFirstFile(firstRead.structuredContent)
    expect(firstFile.content).toContain('依赖追踪')
    expect(firstFile.next_offset).toBeGreaterThan(0)

    const secondRead = await client.callTool({
      name: 'loci_read_files',
      arguments: {
        file_ids: [document.id],
        section_id: `${document.id}:section:0`,
        offset: firstFile.next_offset,
        max_chars_per_file: 1000
      }
    })
    expect(getFirstFile(secondRead.structuredContent).offset).toBe(firstFile.next_offset)

    const progressEvents: number[] = []
    const synced = await client.callTool(
      {
        name: 'loci_sync_libraries',
        arguments: { library_ids: [source.id], wait_for_completion: true }
      },
      {
        onprogress: (progress) => progressEvents.push(progress.progress),
        resetTimeoutOnProgress: true
      }
    )
    expect(synced.structuredContent).toMatchObject({
      items: [{ library_id: source.id, status: 'completed' }]
    })
    expect(progressEvents).toEqual([0, 1])

    const deleted = await client.callTool({
      name: 'loci_delete_library',
      arguments: { library_id: source.id }
    })
    expect(deleted.structuredContent).toEqual({ deleted: true, library_id: source.id })
  })

  it('returns immediately and prevents duplicate background syncs', async () => {
    let crawlCalls = 0
    let active = false
    let resolveCrawl: ((progress: CrawlProgress) => void) | undefined
    const services: LociMcpServices = {
      ...createServices(),
      crawlSource: async () => {
        crawlCalls += 1
        active = true
        return new Promise((resolve) => {
          resolveCrawl = resolve
        })
      },
      isCrawling: () => active,
      getCrawlState: () => (active ? runningState() : undefined)
    }
    httpServer = await startMcpHttpServer(0, services)
    client = await connect(httpServer)

    const first = await client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id] }
    })
    const duplicate = await client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id, source.id] }
    })
    const status = await client.callTool({
      name: 'loci_get_sync_status',
      arguments: { library_ids: [source.id] }
    })

    expect(first.structuredContent).toMatchObject({ items: [{ status: 'syncing' }] })
    expect(duplicate.structuredContent).toMatchObject({ items: [{ status: 'syncing' }] })
    expect(status.structuredContent).toMatchObject({ items: [{ status: 'syncing' }] })
    expect(crawlCalls).toBe(1)
    active = false
    resolveCrawl?.(completedProgress)
    await Promise.resolve()
  })

  it('添加文档库时分别传递两种并发覆盖值', async () => {
    let createdInput: CreateSourceInput | undefined
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      listSources: () => [],
      createSource: (input) => {
        createdInput = input
        return {
          ...source,
          httpConcurrency: input.httpConcurrency,
          browserConcurrency: input.browserConcurrency
        }
      }
    })
    client = await connect(httpServer)

    await client.callTool({
      name: 'loci_add_library',
      arguments: {
        url: source.url,
        http_concurrency: 8,
        browser_concurrency: 2,
        wait_for_completion: true
      }
    })

    expect(createdInput).toMatchObject({ httpConcurrency: 8, browserConcurrency: 2 })
  })

  it('exposes structured failure details and retry guidance', async () => {
    const failedProgress: CrawlProgress = {
      queued: 1,
      processed: 1,
      succeeded: 0,
      failed: 1,
      limitReached: false,
      failures: [
        {
          url: 'https://cn.vuejs.org/missing',
          reason: 'http_error',
          message: '页面返回 HTTP 503',
          retryable: true,
          statusCode: 503
        }
      ]
    }
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      crawlSource: async (_id, onProgress) => {
        onProgress?.(failedProgress)
        return failedProgress
      },
      getCrawlState: () => ({ ...runningState(), progress: failedProgress, running: false })
    })
    client = await connect(httpServer)

    const synced = await client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id], wait_for_completion: true }
    })
    expect(synced.structuredContent).toMatchObject({
      items: [
        {
          status: 'completed_with_errors',
          progress: {
            failures: [{ reason: 'http_error', status_code: 503, retryable: true }]
          }
        }
      ]
    })
  })

  it('rejects non-local browser origins', async () => {
    httpServer = await startMcpHttpServer(0, createServices())
    const response = await fetch(httpServer.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: '{}'
    })
    expect(response.status).toBe(403)
  })
})

function createServices(): LociMcpServices {
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

async function connect(server: McpHttpServer): Promise<Client> {
  const connected = new Client({ name: 'loci-test', version: '1.0.0' })
  await connected.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)))
  return connected
}

function runningState(): CrawlRunState {
  return {
    sourceId: source.id,
    progress: { ...completedProgress, processed: 0, succeeded: 0 },
    nodes: [],
    error: null,
    running: true,
    paused: false
  }
}

function getFirstFile(value: unknown): {
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
