import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices } from './fixtures.js'

describe('MCP hostname 抓取规则', () => {
  it('保存和删除域名自定义规则', async () => {
    const saved = await callLociMcpTool(createServices(), 'loci_save_hostname_policy', {
      hostname: 'docs.example.com',
      http_concurrency: 3,
      browser_concurrency: null,
      batch_interval_min_seconds: 2,
      batch_interval_max_seconds: 5
    })
    const deleted = await callLociMcpTool(createServices(), 'loci_delete_hostname_policy', {
      hostname: 'docs.example.com'
    })

    expect(saved.structuredContent).toMatchObject({
      policy: { hostname: 'docs.example.com', httpConcurrency: 3 }
    })
    expect(deleted.structuredContent).toEqual({ deleted: true })
  })
})
