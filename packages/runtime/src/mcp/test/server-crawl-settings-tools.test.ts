import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices } from './fixtures.js'

describe('Server 抓取策略 MCP 工具', () => {
  it('拒绝旧页面执行参数和域名策略入口', async () => {
    await expect(
      callLociMcpTool(createServices(), 'loci_save_server_crawl_settings', {
        max_concurrent_jobs: 3,
        revision: 1,
        http_concurrency: 4
      })
    ).rejects.toThrow()
    await expect(
      callLociMcpTool(createServices(), 'loci_add_library', {
        url: 'https://example.com/docs',
        http_concurrency: 4
      })
    ).rejects.toThrow()
    await expect(
      callLociMcpTool(createServices(), 'loci_list_hostname_policies', {})
    ).rejects.toThrow()
  })

  it('读取 Server 全局策略', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_get_server_crawl_settings', {})

    expect(response.structuredContent).toMatchObject({
      settings: { maxConcurrentJobs: 3, revision: 1 }
    })
  })

  it('按修订号保存任务容量', async () => {
    const services = createServices()
    const response = await callLociMcpTool(services, 'loci_save_server_crawl_settings', {
      max_concurrent_jobs: 4,
      revision: 1
    })

    expect(response.structuredContent).toMatchObject({
      settings: { maxConcurrentJobs: 4, revision: 2 }
    })
  })
})
