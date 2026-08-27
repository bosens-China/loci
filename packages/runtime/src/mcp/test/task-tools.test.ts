import { describe, expect, it } from 'vitest'
import { callLociMcpTool } from '../tool-registry.js'
import { createServices, localJob } from './fixtures.js'

describe('MCP 持久任务工具', () => {
  it('按域名和日期分页列出任务', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_list_tasks', {
      hostname: localJob.hostname,
      date: '2026-08-03',
      offset: 0,
      limit: 20
    })

    expect(response.structuredContent).toMatchObject({
      total_count: 1,
      items: [{ id: localJob.id, library_id: localJob.sourceId, hostname: localJob.hostname }]
    })
  })

  it('控制单个任务并支持域名级批量恢复', async () => {
    const controlled = await callLociMcpTool(createServices(), 'loci_control_task', {
      task_id: localJob.id,
      action: 'priority',
      priority: 50
    })
    const resumed = await callLociMcpTool(createServices(), 'loci_control_tasks', {
      action: 'resume',
      hostname: localJob.hostname
    })

    expect(controlled.structuredContent).toMatchObject({ task: { priority: 50 } })
    expect(resumed.structuredContent).toEqual({ changed: 1 })
  })
})
