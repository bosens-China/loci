import { describe, expect, it, vi } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import type { CreateSourceInput } from '@loci/shared'
import type { LociMcpServices } from '../server.js'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, source } from './fixtures.js'

describe('MCP source contract', () => {
  it('省略参数时使用产品基础值，不读取其他入口偏好', async () => {
    let createdInput: CreateSourceInput | undefined
    const services: LociMcpServices = {
      ...createServices(),
      listSources: () => [],
      createSource: (input) => {
        createdInput = input
        return { ...source, id: 'new-source', pages: 0 }
      }
    }

    await callLociMcpTool(services, 'loci_add_library', {
      url: 'https://docs.example.com/guide'
    })

    expect(createdInput).toMatchObject(DOCUMENT_SOURCE_DEFAULTS)
  })

  it('只读检查返回规模依据，不创建文档源', async () => {
    const services = createServices()
    const createSource = vi.fn(services.createSource)

    const inspected = await callLociMcpTool(
      { ...services, createSource },
      'loci_inspect_library_source',
      {
        url: 'https://docs.example.com/guide',
        scope_path: '/guide',
        exclude_path: '^/guide/legacy(?:/|$)'
      }
    )

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
    const updateSource: LociMcpServices['updateSource'] = vi.fn((current, input) => ({
      ...current,
      ...{
        mode: input.mode,
        pageLimit: input.pageLimit,
        scopePath: input.scopePath,
        excludePathPattern: input.excludePathPattern
      }
    }))
    const configuredServices = { ...services, crawlSource, updateSource }

    const first = await callLociMcpTool(configuredServices, 'loci_update_library', {
      library_id: source.id,
      page_limit: 2400,
      exclude_path: '^/legacy(?:/|$)'
    })
    const second = await callLociMcpTool(configuredServices, 'loci_update_library', {
      library_id: source.id,
      page_limit: 2400,
      exclude_path: '^/legacy(?:/|$)'
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
    const configuredServices = {
      ...services,
      isCrawling: () => true,
      updateSource
    }

    const response = await callLociMcpTool(configuredServices, 'loci_update_library', {
      library_id: source.id,
      page_limit: 2000
    })

    expect(response.isError).toBe(true)
    expect(updateSource).not.toHaveBeenCalled()
  })
})
