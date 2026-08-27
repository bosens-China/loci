import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, serverJob, serverLibrary } from './fixtures.js'

describe('MCP Server 文档库管理工具', () => {
  it('列出管理员可见文档库并提交同步', async () => {
    const listed = await callLociMcpTool(createServices(), 'loci_list_server_libraries', {
      offset: 0,
      limit: 20
    })
    const synced = await callLociMcpTool(createServices(), 'loci_sync_server_libraries', {
      library_ids: [serverLibrary.id]
    })

    expect(listed.structuredContent).toMatchObject({
      total_count: 1,
      items: [{ id: serverLibrary.id }]
    })
    expect(synced.structuredContent).toEqual({ task_ids: [serverJob.id], count: 1 })
  })

  it('创建、修改和删除文档库', async () => {
    const input = {
      name: serverLibrary.name,
      url: serverLibrary.url,
      scope_path: serverLibrary.scopePath,
      page_limit: serverLibrary.pageLimit,
      schedule: null
    }
    const created = await callLociMcpTool(createServices(), 'loci_create_server_library', input)
    const updated = await callLociMcpTool(createServices(), 'loci_update_server_library', {
      ...input,
      library_id: serverLibrary.id
    })
    const deleted = await callLociMcpTool(createServices(), 'loci_delete_server_library', {
      library_id: serverLibrary.id
    })

    expect(created.structuredContent).toMatchObject({ library: { id: serverLibrary.id } })
    expect(updated.structuredContent).toMatchObject({ library: { id: serverLibrary.id } })
    expect(deleted.structuredContent).toEqual({ deleted: true })
  })
})
