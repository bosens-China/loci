import type { Client } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateSourceInput, CrawlProgress, DocumentSource } from '@loci/shared'
import { isLociMcpAvailable, startMcpHttpServer, type McpHttpServer } from '../http.js'
import type { LociMcpServices } from '../server.js'
import {
  cloudLibrary,
  completedProgress,
  connect,
  createServices,
  document,
  getFirstFile,
  runId,
  runningState,
  source
} from './http-fixtures.js'

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
      'loci_list_sync_failures',
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
    expect(added.structuredContent).toMatchObject({
      created: false,
      sync_status: 'idle',
      library: { availability: 'usable', scope_path: '/' }
    })

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
          retrieval_mode: 'all_terms',
          fallback_used: false,
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
      items: [{ library_id: source.id, sync_status: 'completed', run_id: runId }]
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
    const progressListeners: Array<(progress: CrawlProgress) => void> = []
    const crawlTask = new Promise<CrawlProgress>((resolve) => {
      resolveCrawl = resolve
    })
    const services: LociMcpServices = {
      ...createServices(),
      crawlSource: (_id, onProgress) => {
        if (!active) {
          crawlCalls += 1
          active = true
        }
        if (onProgress) progressListeners.push(onProgress)
        return crawlTask
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
    const waiting = client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id], wait_for_completion: true }
    })

    expect(first.structuredContent).toMatchObject({ items: [{ sync_status: 'syncing' }] })
    expect(duplicate.structuredContent).toMatchObject({ items: [{ sync_status: 'syncing' }] })
    expect(status.structuredContent).toMatchObject({ items: [{ sync_status: 'syncing' }] })
    expect(crawlCalls).toBe(1)
    await vi.waitFor(() => expect(progressListeners).toHaveLength(1))
    progressListeners.forEach((listener) => listener(completedProgress))
    active = false
    resolveCrawl?.(completedProgress)
    expect((await waiting).structuredContent).toMatchObject({
      items: [{ sync_status: 'completed' }]
    })
    expect(crawlCalls).toBe(1)
  })

  it('等待模式会复用只有跨进程锁、尚未读到进度快照的任务', async () => {
    const crawlSource = vi.fn(async () => completedProgress)
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      crawlSource,
      isCrawling: () => true,
      getCrawlState: () => undefined
    })
    client = await connect(httpServer)

    const synced = await client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id], wait_for_completion: true }
    })

    expect(crawlSource).toHaveBeenCalledOnce()
    expect(synced.structuredContent).toMatchObject({
      items: [{ library_id: source.id, sync_status: 'completed' }]
    })
  })

  it('添加文档库时允许覆盖 CLI 抓取默认值', async () => {
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
        name: 'Vue Router',
        mode: 'browser',
        page_limit: 300,
        scope_path: '/guide/',
        http_concurrency: 8,
        browser_concurrency: 2,
        github_archive_limit_mb: 400,
        github_markdown_limit_mb: 160,
        wait_for_completion: true
      }
    })

    expect(createdInput).toMatchObject({
      name: 'Vue Router',
      mode: 'browser',
      pageLimit: 300,
      scopePath: '/guide',
      httpConcurrency: 8,
      browserConcurrency: 2,
      githubArchiveLimitMb: 400,
      githubMarkdownLimitMb: 160
    })
  })

  it('云端同域副本不会阻止创建本地抓取回退', async () => {
    let created = false
    const cloudSource: DocumentSource = {
      ...source,
      id: 'cloud-copy',
      cloud: {
        serverUrl: 'https://cloud.example.com',
        libraryId: 'cloud-vue',
        revision: 'revision-1',
        autoSync: false
      }
    }
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      listSources: () => [cloudSource, ...(created ? [source] : [])],
      createSource: () => {
        created = true
        return source
      }
    })
    client = await connect(httpServer)

    const added = await client.callTool({
      name: 'loci_add_library',
      arguments: { url: source.url, wait_for_completion: true }
    })

    expect(created).toBe(true)
    expect(added.structuredContent).toMatchObject({
      created: true,
      sync_status: 'completed'
    })
  })

  it('先返回失败摘要，再按 run_id 分页读取详情', async () => {
    const failures = Array.from({ length: 7 }, (_, index) => ({
      url: `https://cn.vuejs.org/missing-${index}.md`,
      reason: 'not_found' as const,
      message: 'HTTP 404',
      retryable: false,
      statusCode: 404
    }))
    const failedProgress: CrawlProgress = {
      queued: 7,
      processed: 7,
      succeeded: 0,
      failed: 7,
      limitReached: false,
      failures
    }
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      crawlSource: async (_id, onProgress) => {
        onProgress?.(failedProgress)
        return failedProgress
      },
      getCrawlState: () => ({ ...runningState(), progress: failedProgress, running: false }),
      listCrawlFailures: (id) => (id === runId ? failures : [])
    })
    client = await connect(httpServer)

    const synced = await client.callTool({
      name: 'loci_sync_libraries',
      arguments: { library_ids: [source.id], wait_for_completion: true }
    })
    expect(synced.structuredContent).toMatchObject({
      items: [
        {
          sync_status: 'completed_with_errors',
          run_id: runId,
          progress: {
            failures_total: 7,
            failure_counts: { not_found: 7 },
            has_more_failures: true
          }
        }
      ]
    })
    const progress = (synced.structuredContent as { items: Array<{ progress: unknown }> }).items[0]
      ?.progress as { failures_sample: unknown[] }
    expect(progress.failures_sample).toHaveLength(5)

    const detail = await client.callTool({
      name: 'loci_list_sync_failures',
      arguments: { run_id: runId, offset: 1, limit: 2 }
    })
    expect(detail.structuredContent).toMatchObject({
      library_id: source.id,
      run_id: runId,
      total_count: 7,
      count: 2,
      offset: 1,
      has_more: true,
      next_offset: 3,
      items: [{ url: failures[1]?.url }, { url: failures[2]?.url }]
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
