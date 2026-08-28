import { describe, expect, it, vi } from 'vitest'
import { createDatabase, type LociDatabase } from '../database.js'

describe('本地任务域名调度与控制', () => {
  it('同 hostname 串行，不同 hostname 可以同时领取', () => {
    const database = createDatabase(':memory:')
    try {
      const first = createSource(database, 'Docs A', 'https://docs.example.com/a', '/a')
      const second = createSource(database, 'Docs B', 'https://docs.example.com/b', '/b')
      const other = createSource(database, 'Other', 'https://other.example.com', '/')
      const scheduledAt = new Date('2026-08-27T00:00:00.000Z')
      const firstJob = database.enqueueSourceSync(first, 'background', scheduledAt).job
      const secondJob = database.enqueueSourceSync(second, 'background', scheduledAt).job
      const otherJob = database.enqueueSourceSync(other, 'background', scheduledAt).job

      expect(database.claimNextLocalJob('worker-a', 30_000, scheduledAt)?.id).toBe(firstJob.id)
      expect(database.claimNextLocalJob('worker-b', 30_000, scheduledAt)?.id).toBe(otherJob.id)
      expect(database.getLocalJob(secondJob.id)?.status).toBe('pending')
    } finally {
      database.close()
    }
  })

  it('暂停后保留同一任务，恢复后重新允许领取', () => {
    const database = createDatabase(':memory:')
    const now = new Date('2026-08-27T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const sourceId = createSource(database, 'Docs', 'https://docs.example.com', '/')
      const job = database.enqueueSourceSync(sourceId, 'ui', now).job
      expect(database.claimNextLocalJob('worker-a', 30_000, now)?.id).toBe(job.id)

      expect(database.requestLocalJobPause(job.id)).toMatchObject({ pauseRequested: true })
      expect(database.releasePausedLocalJob(job.id, 'worker-a')).toBe(true)
      expect(database.getLocalJob(job.id)).toMatchObject({ status: 'pending', paused: true })
      expect(database.claimNextLocalJob('worker-b', 30_000, now)).toBeUndefined()

      expect(database.resumeLocalJob(job.id)).toMatchObject({ paused: false })
      expect(database.claimNextLocalJob('worker-b', 30_000, now)?.id).toBe(job.id)
    } finally {
      vi.useRealTimers()
      database.close()
    }
  })

  it('用户手动开始只请求暂停同 hostname 任务并提升目标优先级', () => {
    const database = createDatabase(':memory:')
    try {
      const first = createSource(database, 'Docs A', 'https://docs.example.com/a', '/a')
      const target = createSource(database, 'Docs B', 'https://docs.example.com/b', '/b')
      const other = createSource(database, 'Other', 'https://other.example.com', '/')
      const now = new Date('2026-08-27T00:00:00.000Z')
      const firstJob = database.enqueueSourceSync(first, 'background', now).job
      const otherJob = database.enqueueSourceSync(other, 'background', now).job
      expect(database.claimNextLocalJob('worker-a', 30_000, now)?.id).toBe(firstJob.id)
      expect(database.claimNextLocalJob('worker-b', 30_000, now)?.id).toBe(otherJob.id)

      const targetJob = database.enqueueSourceSync(target, 'ui', now).job
      expect(database.getLocalJob(firstJob.id)?.pauseRequested).toBe(true)
      expect(database.getLocalJob(otherJob.id)?.pauseRequested).toBe(false)
      expect(targetJob).toMatchObject({ priority: 100, paused: false })
    } finally {
      database.close()
    }
  })

  it('结束提交部分进度，并把剩余 URL 继承给下一次任务', () => {
    const database = createDatabase(':memory:')
    try {
      const sourceId = createSource(database, 'Docs', 'https://docs.example.com', '/')
      const now = new Date('2026-08-27T00:00:00.000Z')
      const job = database.enqueueSourceSync(sourceId, 'ui', now).job
      expect(database.claimNextLocalJob('worker-a', 30_000, now)?.id).toBe(job.id)
      const progress = {
        queued: 3,
        processed: 1,
        succeeded: 1,
        failed: 0,
        limitReached: false
      }
      const remaining = ['https://docs.example.com/two', 'https://docs.example.com/three']
      expect(database.checkpointLocalJob(job.id, 'worker-a', progress, remaining, 128)).toBe(true)
      expect(database.requestLocalJobStop(job.id)).toMatchObject({ stopRequested: true })
      expect(database.completePartialLocalJob(job.id, 'worker-a', progress, 128)).toBe(true)
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'completed',
        partial: true,
        contentBytes: 128,
        remainingCount: 2
      })

      const resumed = database.enqueueSourceSync(sourceId, 'ui', now).job
      expect(resumed.id).not.toBe(job.id)
      expect(database.getLocalJobResumeUrls(resumed.id)).toEqual(remaining)
    } finally {
      database.close()
    }
  })

  it('取消新建文档库的首个等待任务会连同文档库一起删除', () => {
    const database = createDatabase(':memory:')
    try {
      const sourceId = createSource(database, 'New Docs', 'https://new.example.com', '/')
      const job = database.enqueueSourceSync(sourceId, 'ui', new Date(), {
        deleteSourceOnCancel: true
      }).job

      expect(database.requestLocalJobCancellation(job.id)).toMatchObject({ status: 'cancelled' })
      expect(database.listSources()).toEqual([])
      expect(database.getLocalJob(job.id)).toBeUndefined()
    } finally {
      database.close()
    }
  })

  it('运行中的新库任务在 worker 确认取消后删除文档库', () => {
    const database = createDatabase(':memory:')
    try {
      const sourceId = createSource(database, 'New Docs', 'https://new.example.com', '/')
      const now = new Date('2026-08-27T00:00:00.000Z')
      const job = database.enqueueSourceSync(sourceId, 'ui', now, {
        deleteSourceOnCancel: true
      }).job
      expect(database.claimNextLocalJob('worker-a', 30_000, now)?.id).toBe(job.id)

      expect(database.requestLocalJobCancellation(job.id)).toMatchObject({ status: 'running' })
      expect(database.releaseLocalJob(job.id, 'worker-a', 'cancelled')).toBe(true)
      expect(database.listSources()).toEqual([])
    } finally {
      database.close()
    }
  })
})

function createSource(
  database: LociDatabase,
  name: string,
  url: string,
  scopePath: string
): string {
  return database.createSource({
    name,
    url,
    mode: 'http',
    pageLimit: 100,
    scopePath,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  }).id
}
