import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, document } from './fixtures.js'

describe('MCP 多文档移动工具', () => {
  it('返回可重试的结构化移动结果', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_move_documents_to_new_library', {
      document_ids: [document.id],
      name: 'Combined',
      url: 'https://combined.example.com/docs',
      scope_path: '/',
      page_limit: 100,
      delete_empty_sources: true,
      operation_id: 'move-1'
    })

    expect(response.structuredContent).toMatchObject({
      operation_id: 'move-1',
      moved: 1,
      reused: false
    })
  })
})
