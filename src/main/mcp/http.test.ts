import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentRecord, DocumentSource } from '../../shared/api'
import { startMcpHttpServer, type McpHttpServer } from './http'
import type { DocHubMcpServices } from './server'

const source: DocumentSource = {
  id: 'doc-vue',
  name: 'Vue 中文文档',
  url: 'https://cn.vuejs.org/guide/',
  mode: 'http',
  status: 'healthy',
  pages: 1,
  pageLimit: 1000,
  lastUpdated: '刚刚',
  schedule: null,
  concurrency: null,
  iconUrl: 'https://cn.vuejs.org/logo.svg'
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
  content: '# 响应式基础\n\n读取属性时进行依赖追踪。'
}

describe('MCP HTTP server', () => {
  let httpServer: McpHttpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await httpServer?.close()
  })

  it('supports discovery, tree browsing, search and file reading over HTTP', async () => {
    httpServer = await startMcpHttpServer(0, createServices())
    client = new Client({ name: 'doc-hub-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.endpoint)))

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'doc_hub_add_document',
      'doc_hub_sync_documents',
      'doc_hub_list_documents',
      'doc_hub_get_tree',
      'doc_hub_read_files',
      'doc_hub_search',
      'doc_hub_delete_document'
    ])

    const listed = await client.callTool({ name: 'doc_hub_list_documents', arguments: {} })
    expect(listed.structuredContent).toMatchObject({ total_count: 1 })

    const added = await client.callTool({
      name: 'doc_hub_add_document',
      arguments: { url: source.url }
    })
    expect(added.structuredContent).toMatchObject({ created: false })

    const tree = await client.callTool({
      name: 'doc_hub_get_tree',
      arguments: { document_id: source.id }
    })
    expect(tree.structuredContent).toMatchObject({
      nodes: [{ title: 'guide', children: [{ title: 'essentials' }] }]
    })

    const searched = await client.callTool({
      name: 'doc_hub_search',
      arguments: { query: '依赖追踪' }
    })
    expect(searched.structuredContent).toMatchObject({
      items: [{ file_id: document.id, section_title: '响应式基础' }]
    })

    const read = await client.callTool({
      name: 'doc_hub_read_files',
      arguments: { file_ids: [document.id] }
    })
    expect(read.structuredContent).toMatchObject({
      files: [{ id: document.id, source_url: document.url }]
    })

    const synced = await client.callTool({
      name: 'doc_hub_sync_documents',
      arguments: { document_ids: [source.id] }
    })
    expect(synced.structuredContent).toMatchObject({
      items: [{ document_id: source.id, status: 'completed' }]
    })

    const deleted = await client.callTool({
      name: 'doc_hub_delete_document',
      arguments: { document_id: source.id }
    })
    expect(deleted.structuredContent).toMatchObject({ deleted: true })
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

  it('reports an active crawl without starting duplicate work', async () => {
    let crawlCalls = 0
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      isCrawling: () => true,
      crawlSource: async () => {
        crawlCalls += 1
        throw new Error('不应重复抓取')
      }
    })
    client = new Client({ name: 'doc-hub-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.endpoint)))

    const added = await client.callTool({
      name: 'doc_hub_add_document',
      arguments: { url: source.url }
    })
    expect(added.structuredContent).toMatchObject({ document: { status: 'syncing' } })

    const synced = await client.callTool({
      name: 'doc_hub_sync_documents',
      arguments: { document_ids: [source.id, source.id] }
    })
    expect(synced.structuredContent).toMatchObject({
      items: [{ document_id: source.id, status: 'syncing' }]
    })
    expect(crawlCalls).toBe(0)
  })

  it('makes partial crawl failures explicit', async () => {
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      crawlSource: async () => ({
        queued: 3,
        processed: 3,
        succeeded: 2,
        failed: 1,
        limitReached: false
      })
    })
    client = new Client({ name: 'doc-hub-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.endpoint)))

    const synced = await client.callTool({
      name: 'doc_hub_sync_documents',
      arguments: { document_ids: [source.id] }
    })
    expect(synced.structuredContent).toMatchObject({
      items: [
        {
          document_id: source.id,
          status: 'completed_with_errors',
          warning: '1 个页面抓取失败'
        }
      ]
    })
    expect(synced.content).toEqual([{ type: 'text', text: `${source.id}: completed_with_errors` }])
  })
})

function createServices(): DocHubMcpServices {
  return {
    listSources: () => [source],
    listDocuments: () => [document],
    searchDocuments: () => [document],
    createSource: () => source,
    crawlSource: async () => ({
      queued: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      limitReached: false
    }),
    deleteSource: () => undefined,
    isCrawling: () => false
  }
}
