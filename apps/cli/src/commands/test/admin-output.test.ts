import { describe, expect, it } from 'vitest'
import type { CloudLibrary, CloudSyncJob } from '@loci/shared'
import {
  createAdminJobTable,
  createAdminLibraryTable,
  formatAdminJobProgress
} from '../admin-output.js'
import { activeAdminJobs, resolveAdminJob } from '../admin-tasks.js'

describe('CLI Admin 输出', () => {
  it('文档库列表包含发布状态与错误', () => {
    const table = createAdminLibraryTable([
      library({ publishedAt: '2026-08-21T00:00:00.000Z' }),
      library({ id: 'needs-check', lastError: '入口页面读取失败' })
    ])
    expect(table.headers).toContain('发布状态')
    expect(table.headers).toContain('错误')
    expect(table.rows[0]).toContain('已发布')
    expect(table.rows[1]).toContain('需检查')
    expect(table.rows[1]).toContain('入口页面读取失败')
  })

  it('任务列表包含页面进度、失败页数和中文状态', () => {
    const running = job('running')
    const table = createAdminJobTable([running])
    expect(table.headers).toEqual(expect.arrayContaining(['状态', '页面进度', '失败页']))
    expect(table.rows[0]).toEqual(expect.arrayContaining(['同步中', '已处理 3 · 待处理 2', 1]))
    expect(formatAdminJobProgress({ ...running, status: 'completed' })).toBe('完成 3 页')
  })

  it('交互取消只提供活动任务', () => {
    expect(activeAdminJobs([job('queued'), job('completed')]).map((item) => item.status)).toEqual([
      'queued'
    ])
  })

  it('脚本取消支持唯一短 ID，并优先解析完整 ID', () => {
    const exact = job('queued', 'task-1234')
    const prefixed = job('running', 'task-1234-extra')
    const unique = job('queued', 'unique-5678-extra')

    expect(resolveAdminJob([exact, prefixed, unique], 'task-1234')).toBe(exact)
    expect(resolveAdminJob([exact, prefixed, unique], 'unique-5678')).toBe(unique)
  })

  it('脚本取消拒绝歧义或不存在的任务短 ID', () => {
    const jobs = [job('queued', 'shared-one'), job('running', 'shared-two')]
    expect(() => resolveAdminJob(jobs, 'shared')).toThrow('同步任务引用不唯一')
    expect(() => resolveAdminJob(jobs, 'missing')).toThrow('找不到 Server 同步任务')
  })
})

function library(overrides: Partial<CloudLibrary> = {}): CloudLibrary {
  return {
    id: 'library-1',
    name: '示例文档',
    url: 'https://example.com/docs',
    hostname: 'example.com',
    scopePath: '/docs',
    pageLimit: 100,
    schedule: null,
    pages: 3,
    lastCrawledAt: null,
    lastError: null,
    revision: null,
    publishedAt: null,
    ...overrides
  }
}

function job(status: CloudSyncJob['status'], id = `job-${status}`): CloudSyncJob {
  return {
    id,
    libraryId: 'library-1',
    status,
    createdAt: '2026-08-21T00:00:00.000Z',
    finishedAt: null,
    progress: {
      queued: 2,
      processed: 3,
      succeeded: 2,
      failed: 1,
      limitReached: false
    },
    failures: [],
    error: null
  }
}
