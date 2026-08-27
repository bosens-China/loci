import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('结构化操作日志', () => {
  it('跨任务入口记录事件并支持日期与 hostname 筛选', () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Logs',
      url: 'https://logs.example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const job = database.enqueueSourceSync(source.id, 'mcp').job
    database.requestLocalJobPause(job.id)
    database.resumeLocalJob(job.id)

    const date = localDate(new Date())
    const page = database.listOperationLogs({
      date,
      hostname: 'logs.example.com',
      category: 'task'
    })
    expect(page.total).toBe(3)
    expect(page.items.map((item) => item.action)).toEqual(['resume', 'pause', 'enqueue'])
    expect(page.items.every((item) => item.resourceId === job.id)).toBe(true)
    database.close()
  })
})

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
