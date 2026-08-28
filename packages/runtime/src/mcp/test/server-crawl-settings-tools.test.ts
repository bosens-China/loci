import { describe, expect, it, vi } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices } from './fixtures.js'

describe('Server 抓取策略 MCP 工具', () => {
  it('读取 Server 全局策略', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_get_server_crawl_settings', {})

    expect(response.structuredContent).toMatchObject({
      settings: { maxConcurrentJobs: 3, httpConcurrency: 9, revision: 1 }
    })
  })

  it('按修订号保存完整策略', async () => {
    const services = createServices()
    const save = vi.spyOn(services, 'saveServerCrawlSettings')
    const response = await callLociMcpTool(services, 'loci_save_server_crawl_settings', {
      max_concurrent_jobs: 4,
      http_concurrency: 8,
      browser_concurrency: 4,
      batch_interval_min_seconds: 100,
      batch_interval_max_seconds: 200,
      revision: 1
    })

    expect(save).toHaveBeenCalledWith({
      maxConcurrentJobs: 4,
      httpConcurrency: 8,
      browserConcurrency: 4,
      batchIntervalMinSeconds: 100,
      batchIntervalMaxSeconds: 200,
      revision: 1
    })
    expect(response.structuredContent).toMatchObject({ settings: { revision: 2 } })
  })
})
