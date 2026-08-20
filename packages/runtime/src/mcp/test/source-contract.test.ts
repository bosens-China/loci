import type { Client } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import type { CreateSourceInput } from '@loci/shared'
import { startMcpHttpServer, type McpHttpServer } from '../http.js'
import { connect, createServices, source } from './http-fixtures.js'

describe('MCP source contract', () => {
  let httpServer: McpHttpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await httpServer?.close()
  })

  it('省略参数时使用产品基础值，不读取其他入口偏好', async () => {
    let createdInput: CreateSourceInput | undefined
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      listSources: () => [],
      createSource: (input) => {
        createdInput = input
        return { ...source, id: 'new-source', pages: 0 }
      }
    })
    client = await connect(httpServer)

    await client.callTool({
      name: 'loci_add_library',
      arguments: { url: 'https://docs.example.com/guide' }
    })

    expect(createdInput).toMatchObject(DOCUMENT_SOURCE_DEFAULTS)
  })

  it('只读检查返回规模依据，不创建文档源', async () => {
    const services = createServices()
    const createSource = vi.fn(services.createSource)
    httpServer = await startMcpHttpServer(0, { ...services, createSource })
    client = await connect(httpServer)

    const inspected = await client.callTool({
      name: 'loci_inspect_library_source',
      arguments: {
        url: 'https://docs.example.com/guide',
        scope_path: '/guide',
        exclude_path: '^/guide/legacy(?:/|$)'
      }
    })

    expect(inspected.structuredContent).toMatchObject({
      discovery: 'sitemap',
      estimate_kind: 'exact',
      estimated_pages: 1,
      path_groups: [{ path: '/guide', pages: 1 }]
    })
    expect(createSource).not.toHaveBeenCalled()
  })

  it('按文档库 ID 幂等更新可选抓取配置且不自动同步', async () => {
    const services = createServices()
    const crawlSource = vi.fn(services.crawlSource)
    const updateSource = vi.fn((current, input) => ({
      ...current,
      ...{
        mode: input.mode,
        pageLimit: input.pageLimit,
        scopePath: input.scopePath,
        excludePathPattern: input.excludePathPattern
      }
    }))
    httpServer = await startMcpHttpServer(0, { ...services, crawlSource, updateSource })
    client = await connect(httpServer)

    const first = await client.callTool({
      name: 'loci_update_library',
      arguments: {
        library_id: source.id,
        page_limit: 2400,
        exclude_path: '^/legacy(?:/|$)'
      }
    })
    const second = await client.callTool({
      name: 'loci_update_library',
      arguments: {
        library_id: source.id,
        page_limit: 2400,
        exclude_path: '^/legacy(?:/|$)'
      }
    })

    expect(first.structuredContent).toMatchObject({
      changed: true,
      library: { page_limit: 2400, exclude_path: '^/legacy(?:/|$)' }
    })
    expect(second.isError).not.toBe(true)
    expect(updateSource).toHaveBeenCalledTimes(2)
    expect(crawlSource).not.toHaveBeenCalled()
  })

  it('同步期间拒绝更新同一文档库', async () => {
    const services = createServices()
    const updateSource = vi.fn(services.updateSource)
    httpServer = await startMcpHttpServer(0, {
      ...services,
      isCrawling: () => true,
      updateSource
    })
    client = await connect(httpServer)

    const response = await client.callTool({
      name: 'loci_update_library',
      arguments: { library_id: source.id, page_limit: 2000 }
    })

    expect(response.isError).toBe(true)
    expect(updateSource).not.toHaveBeenCalled()
  })
})
