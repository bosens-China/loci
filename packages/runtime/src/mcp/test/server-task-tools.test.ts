import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, serverJob } from './fixtures.js'

describe('MCP Server 持久任务工具', () => {
  it('按域名和日期列出 Server 任务', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_list_server_tasks', {
      hostname: serverJob.hostname,
      date: '2026-08-03',
      offset: 0,
      limit: 20
    })

    expect(response.structuredContent).toMatchObject({
      total_count: 1,
      items: [{ id: serverJob.id, library_id: serverJob.libraryId }]
    })
  })

  it('控制单个和域名级 Server 任务', async () => {
    const prioritized = await callLociMcpTool(createServices(), 'loci_control_server_task', {
      task_id: serverJob.id,
      action: 'priority',
      priority: 50
    })
    const paused = await callLociMcpTool(createServices(), 'loci_control_server_tasks', {
      action: 'pause',
      hostname: serverJob.hostname
    })

    expect(prioritized.structuredContent).toMatchObject({ task: { priority: 50 } })
    expect(paused.structuredContent).toEqual({ changed: 1 })
  })
})
