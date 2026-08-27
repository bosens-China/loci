import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { cloudLibrary, createServices, document } from './fixtures.js'

describe('MCP 云端渐进读取工具', () => {
  it('先读取目录，再按文件 ID 读取正文', async () => {
    const tree = await callLociMcpTool(createServices(), 'loci_get_cloud_library_tree', {
      library_id: cloudLibrary.id,
      depth: 1
    })
    const file = await callLociMcpTool(createServices(), 'loci_read_cloud_library_file', {
      library_id: cloudLibrary.id,
      file_id: document.id,
      offset: 0,
      max_chars: 20_000
    })

    expect(tree.structuredContent).toMatchObject({
      tree: [{ id: document.id, readable: true }]
    })
    expect(file.structuredContent).toMatchObject({
      file: { id: document.id, content: document.content, truncated: false }
    })
  })
})
