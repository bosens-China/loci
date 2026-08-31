import type { LocalJob } from '@loci/shared'
import { describe, expect, it } from 'vitest'
import {
  estimateRemainingMs,
  filterJobs,
  getJobProgressView,
  getLatestActiveJobsBySource,
  groupJobsByHostname,
  jobViewStatus,
  upsertLocalJob
} from '../job-state'

describe('任务域名视图状态', () => {
  it('按 hostname 分组并把活动域名排在前面', () => {
    const groups = groupJobsByHostname([
      job({ id: 'a', hostname: 'idle.example.com', status: 'completed' }),
      job({ id: 'b', hostname: 'active.example.com', status: 'running' }),
      job({ id: 'c', hostname: 'active.example.com', status: 'pending' })
    ])

    expect(groups.map((group) => [group.hostname, group.jobs.length, group.active])).toEqual([
      ['active.example.com', 2, 2],
      ['idle.example.com', 1, 0]
    ])
  })

  it('区分暂停中、已暂停、结束中和部分结束', () => {
    expect(jobViewStatus(job({ status: 'running', pauseRequested: true }))).toBe('pausing')
    expect(jobViewStatus(job({ status: 'pending', paused: true }))).toBe('paused')
    expect(jobViewStatus(job({ status: 'running', stopRequested: true }))).toBe('stopping')
    expect(jobViewStatus(job({ status: 'completed', partial: true }))).toBe('stopped')
  })

  it('组合筛选任务并根据已处理速度估算剩余时间', () => {
    const running = job({
      hostname: 'docs.example.com',
      sourceId: 'source-a',
      status: 'running',
      startedAt: '2026-08-27T00:00:00.000Z',
      scheduledAt: '2026-08-27T00:00:00.000Z',
      result: { queued: 10, processed: 4, succeeded: 4, failed: 0, limitReached: false }
    })
    const filtered = filterJobs([running], new Map([['source-a', 'Loci Docs']]), {
      query: 'loci',
      date: '2026-08-27',
      status: 'running'
    })

    expect(filtered).toEqual([running])
    expect(estimateRemainingMs(running, new Date('2026-08-27T00:00:40.000Z').getTime())).toBe(
      60_000
    )
  })

  it('未知总量时保持准备状态，总量确定后再计算真实百分比', () => {
    const preparing = job({
      status: 'running',
      result: {
        queued: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        limitReached: false,
        node: { id: 'spec', url: 'https://api.example.com', title: '探测中', status: 'running' }
      }
    })
    const converting = job({
      status: 'running',
      result: {
        queued: 560,
        processed: 28,
        succeeded: 28,
        failed: 0,
        limitReached: false
      }
    })

    expect(getJobProgressView(preparing)).toMatchObject({
      kind: 'indeterminate',
      processed: 0
    })
    expect(getJobProgressView(converting)).toMatchObject({
      kind: 'determinate',
      processed: 28,
      total: 560,
      percent: 5
    })
  })

  it('为卡片选择最新活动任务，并用接口返回状态更新缓存', () => {
    const completed = job({ id: 'completed', sourceId: 'source-a', status: 'completed' })
    const older = job({
      id: 'older',
      sourceId: 'source-a',
      status: 'running',
      updatedAt: '2026-08-27T00:00:01.000Z'
    })
    const latest = job({
      id: 'latest',
      sourceId: 'source-a',
      status: 'pending',
      updatedAt: '2026-08-27T00:00:02.000Z'
    })

    expect(getLatestActiveJobsBySource([completed, older, latest]).get('source-a')).toBe(latest)
    expect(upsertLocalJob([older], { ...older, status: 'completed' })).toEqual([
      expect.objectContaining({ id: 'older', status: 'completed' })
    ])
    expect(upsertLocalJob([older], latest).map((item) => item.id)).toEqual(['latest', 'older'])
  })
})

function job(overrides: Partial<LocalJob>): LocalJob {
  return {
    id: 'job',
    kind: 'source_sync',
    resourceKey: 'source:source',
    sourceId: 'source',
    hostname: 'docs.example.com',
    trigger: 'ui',
    status: 'completed',
    priority: 0,
    paused: false,
    pauseRequested: false,
    stopRequested: false,
    partial: false,
    contentBytes: 0,
    remainingCount: 0,
    scheduledAt: '2026-08-27T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    attemptCount: 0,
    cancelRequested: false,
    error: null,
    result: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides
  }
}
