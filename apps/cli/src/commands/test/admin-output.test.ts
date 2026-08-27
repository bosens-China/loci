import { describe, expect, it } from 'vitest'
import type { CloudSyncJob } from '@loci/shared'
import { activeAdminJobs, resolveAdminJob } from '../admin-tasks.js'

describe('CLI Admin 任务引用', () => {
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

function job(status: CloudSyncJob['status'], id = `job-${status}`): CloudSyncJob {
  return {
    id,
    libraryId: 'library-1',
    hostname: 'example.com',
    status,
    priority: 0,
    paused: false,
    pauseRequested: false,
    stopRequested: false,
    partial: false,
    contentBytes: 0,
    remainingCount: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
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
