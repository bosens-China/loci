import type { Client } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { startMcpHttpServer, type McpHttpServer } from '../http.js'
import { connect, createServices, document } from './http-fixtures.js'

describe('MCP search', () => {
  let httpServer: McpHttpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await httpServer?.close()
  })

  it('严格搜索无结果时自动放宽，并在放宽后应用路径过滤', async () => {
    const modes: string[] = []
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      searchDocuments: (_query, mode) => {
        modes.push(mode ?? 'all')
        return mode === 'any' ? [document] : []
      }
    })
    client = await connect(httpServer)

    const found = await client.callTool({
      name: 'loci_search_files',
      arguments: {
        queries: ['响应式 不存在'],
        path_prefix: '/guide/essentials'
      }
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
