import { describe, expect, it } from 'vitest'
import type { LociMcpServices } from '../server.js'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, document } from './fixtures.js'

describe('MCP search', () => {
  it('严格搜索无结果时自动放宽，并在放宽后应用路径过滤', async () => {
    const modes: string[] = []
    const services: LociMcpServices = {
      ...createServices(),
      searchDocuments: (_query, mode) => {
        modes.push(mode ?? 'all')
        return mode === 'any' ? [document] : []
      }
    }

    const found = await callLociMcpTool(services, 'loci_search_files', {
      queries: ['响应式 不存在'],
      path_prefix: '/guide/essentials'
    })
    expect(modes).toEqual(['all', 'any'])
    expect(found.structuredContent).toMatchObject({
      results: [
        {
          retrieval_mode: 'any_terms',
          fallback_used: true,
          items: [{ file_id: document.id }]
        }
      ]
    })
  })
})
