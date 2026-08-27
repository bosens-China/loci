import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type LociDatabase, type SourceCrawlCommit } from '../database.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local job database', () => {
  it('跨连接复用同一资源的活动任务', () => {
    const { first, second, sourceId } = createPair()
    try {
      const initial = first.enqueueSourceSync(sourceId, 'ui')
      const repeated = second.enqueueSourceSync(sourceId, 'mcp')

      expect(initial.reused).toBe(false)
      expect(repeated.reused).toBe(true)
      expect(repeated.job.id).toBe(initial.job.id)
    } finally {
      first.close()
      second.close()
    }
  })

  it('使用 owner 和 lease 认领、续租并完成任务', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, null)
      const queued = database.enqueueSourceSync(sourceId, 'background').job
      const claimed = database.claimNextLocalJob('worker-a', 30_000)

      expect(claimed).toMatchObject({ id: queued.id, status: 'running', attemptCount: 1 })
      expect(database.claimNextLocalJob('worker-b', 30_000)).toBeUndefined()
      expect(database.heartbeatLocalJob(queued.id, 'worker-b', 30_000)).toBe(false)
      expect(database.heartbeatLocalJob(queued.id, 'worker-a', 30_000)).toBe(true)
      const result = {
        queued: 1,
        processed: 1,
        succeeded: 1,
        failed: 0,
        limitReached: false
      }
      expect(database.completeLocalJob(queued.id, 'worker-a', result)).toBe(true)
      expect(database.getLocalJob(queued.id)).toMatchObject({ status: 'completed', result })
    } finally {
      database.close()
    }
  })

  it('跨连接按序号读取逐页事件，并幂等忽略重复完成回调', () => {
    const { first, second, sourceId } = createPair()
    try {
      const job = first.enqueueSourceSync(sourceId, 'mcp').job
      expect(first.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      const progress = {
        queued: 2,
        processed: 1,
        succeeded: 1,
        failed: 0,
        limitReached: false,
        node: {
          id: 'https://vite.dev/guide',
          url: 'https://vite.dev/guide',
          title: 'Guide',
          status: 'success' as const
        }
      }

      const event = first.recordLocalJobProgress(job.id, 'worker-a', progress, 'run-1')
      expect(first.recordLocalJobProgress(job.id, 'worker-a', progress, 'run-1')).toBeUndefined()
      expect(second.listLocalJobEvents(job.id)).toEqual([
        expect.objectContaining({
          sequence: event?.sequence,
          jobId: job.id,
          sourceId,
          runId: 'run-1',
          node: expect.objectContaining({ title: 'Guide', status: 'success' })
        })
      ])
      expect(second.listLocalJobEvents(job.id, event?.sequence ?? 0)).toEqual([])
      expect(second.getLocalJob(job.id)?.result).toMatchObject({ processed: 1 })
    } finally {
      first.close()
      second.close()
    }
  })

  it('恢复过期任务，并在连续中断后停止重试', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, null)
      let now = new Date('2026-08-20T00:00:00.000Z')
      const job = database.enqueueSourceSync(sourceId, 'manual', now).job

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claimed = database.claimNextLocalJob(`worker-${attempt}`, 1_000, now)
        expect(claimed).toMatchObject({ attemptCount: attempt, result: null, error: null })
        database.recordLocalJobProgress(
          job.id,
          `worker-${attempt}`,
          crawlProgress(attempt),
          `run-${attempt}`
        )
        expect(database.getLocalJob(job.id)?.result).toMatchObject({ processed: attempt })
        now = new Date(now.getTime() + 2_000)
      }

      expect(database.claimNextLocalJob('worker-4', 1_000, now)).toBeUndefined()
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'failed',
        error: '后台任务连续中断，已停止自动恢复',
        result: { processed: 3 },
        heartbeatAt: null
      })
    } finally {
      database.close()
    }
  })

  it('过期恢复保留检查点进度，随后取消再丢弃本次进度', () => {
    const database = createMemoryDatabase()
    try {
      const startedAt = new Date('2026-08-20T00:00:00.000Z')
      const sourceId = createSource(database, null)
      const job = database.enqueueSourceSync(sourceId, 'background', startedAt).job
      expect(database.claimNextLocalJob('worker-a', 1_000, startedAt)?.id).toBe(job.id)
      database.recordLocalJobProgress(job.id, 'worker-a', crawlProgress(1), 'run-a')

      const otherSourceId = createOtherSource(database)
      const earlier = new Date(startedAt.getTime() - 1)
      const otherJob = database.enqueueSourceSync(otherSourceId, 'background', earlier).job
      const recoveredAt = new Date(startedAt.getTime() + 2_000)
      expect(database.claimNextLocalJob('worker-b', 1_000, recoveredAt)?.id).toBe(otherJob.id)
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'pending',
        result: { processed: 1 },
        error: '执行进程意外退出，任务等待恢复'
      })

      expect(database.requestLocalJobCancellation(job.id)).toMatchObject({
        status: 'cancelled',
        result: null,
        error: '任务已取消',
        leaseOwner: null,
        heartbeatAt: null
      })
    } finally {
      database.close()
    }
  })

  it('跨连接把取消后租约过期的任务原子终结并允许重新提交', () => {
    const { first, second, sourceId } = createPair()
    try {
      const startedAt = new Date('2026-08-20T00:00:00.000Z')
      const initial = first.enqueueSourceSync(sourceId, 'mcp', startedAt).job
      expect(first.claimNextLocalJob('worker-a', 1_000, startedAt)?.id).toBe(initial.id)
      first.recordLocalJobProgress(initial.id, 'worker-a', crawlProgress(1), 'run-a')
      expect(second.requestLocalJobCancellation(initial.id)?.status).toBe('running')

      const recoveredAt = new Date(startedAt.getTime() + 2_000)
      expect(second.claimNextLocalJob('worker-b', 1_000, recoveredAt)).toBeUndefined()
      expect(first.getLocalJob(initial.id)).toMatchObject({
        status: 'cancelled',
        cancelRequested: true,
        leaseOwner: null,
        leaseExpiresAt: null,
        error: '任务已取消',
        result: null
      })
      expect(first.getLocalJob(initial.id)?.finishedAt).toBe(recoveredAt.toISOString())

      const repeated = second.enqueueSourceSync(sourceId, 'mcp', recoveredAt)
      expect(repeated).toMatchObject({ reused: false })
      expect(repeated.job.id).not.toBe(initial.id)
      expect(first.claimNextLocalJob('worker-b', 1_000, recoveredAt)?.id).toBe(repeated.job.id)
    } finally {
      first.close()
      second.close()
    }
  })

  it('释放任务与取消请求竞争时仍保持 cancelled 终态', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, null)
      const job = database.enqueueSourceSync(sourceId, 'background').job
      expect(database.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)

      database.requestLocalJobCancellation(job.id)
      expect(database.releaseLocalJob(job.id, 'worker-a', '任务等待恢复')).toBe(true)
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'cancelled',
        cancelRequested: true,
        leaseOwner: null,
        error: '任务已取消'
      })
    } finally {
      database.close()
    }
  })

  it('完成与取消竞争时不在 cancelled 终态保留成功结果', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, null)
      const job = database.enqueueSourceSync(sourceId, 'background').job
      expect(database.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      database.requestLocalJobCancellation(job.id)
      expect(
        database.recordLocalJobProgress(job.id, 'worker-a', crawlProgress(1), 'run-a')
      ).toBeUndefined()

      expect(
        database.completeLocalJob(job.id, 'worker-a', {
          queued: 1,
          processed: 1,
          succeeded: 1,
          failed: 0,
          limitReached: false
        })
      ).toBe(true)
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'cancelled',
        result: null,
        error: '任务已取消'
      })
    } finally {
      database.close()
    }
  })

  it('取消先赢得事务时不提交正文或成功运行结果', () => {
    const { first, second, sourceId } = createPair()
    try {
      const job = first.enqueueSourceSync(sourceId, 'background').job
      expect(first.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      const runId = first.startCrawlRun(sourceId)
      second.requestLocalJobCancellation(job.id)

      expect(
        first.commitSourceCrawl(sourceId, sourceCommit(sourceId, job.id, runId, 'worker-a'))
      ).toBe(false)
      expect(first.listDocuments()).toEqual([])
      expect(first.getCrawlRun(runId)?.status).toBe('running')
      expect(first.getLocalJob(job.id)).toMatchObject({
        status: 'running',
        cancelRequested: true,
        result: null
      })
    } finally {
      first.close()
      second.close()
    }
  })

  it('提交先赢得事务时原子完成正文、运行和任务', () => {
    const { first, second, sourceId } = createPair()
    try {
      const job = first.enqueueSourceSync(sourceId, 'background').job
      expect(first.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      const runId = first.startCrawlRun(sourceId)

      expect(
        first.commitSourceCrawl(sourceId, sourceCommit(sourceId, job.id, runId, 'worker-a'))
      ).toBe(true)
      expect(second.requestLocalJobCancellation(job.id)).toMatchObject({
        status: 'completed',
        cancelRequested: false
      })
      expect(first.listDocumentUrls(sourceId)).toEqual(['https://vite.dev/guide'])
      expect(first.getCrawlRun(runId)?.status).toBe('completed')
      expect(first.getLocalJob(job.id)).toMatchObject({
        status: 'completed',
        result: { processed: 1, succeeded: 1 }
      })
    } finally {
      first.close()
      second.close()
    }
  })

  it('把多个错过时间点合并为一个计划任务', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, '* * * * *')
      const start = new Date('2026-08-20T00:00:00.000Z')
      database.refreshSourceSchedules(start)

      expect(database.enqueueDueSourceSchedules(start)).toEqual([])
      const overdue = database.enqueueDueSourceSchedules(new Date('2026-08-20T00:05:00.000Z'))
      const repeated = database.enqueueDueSourceSchedules(new Date('2026-08-20T00:05:30.000Z'))

      expect(overdue).toHaveLength(1)
      expect(overdue[0]?.job).toMatchObject({ sourceId, trigger: 'schedule' })
      expect(repeated).toEqual([])
    } finally {
      database.close()
    }
  })
})

function createPair(): { first: LociDatabase; second: LociDatabase; sourceId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'loci-jobs-'))
  directories.push(directory)
  const filename = join(directory, 'loci.sqlite')
  const first = createDatabase(filename)
  const sourceId = createSource(first, null)
  const second = createDatabase(filename)
  return { first, second, sourceId }
}

function createMemoryDatabase(): LociDatabase {
  return createDatabase(':memory:')
}

function createSource(database: LociDatabase, schedule: string | null): string {
  return database.createSource({
    name: 'Vite',
    url: 'https://vite.dev',
    mode: 'http',
    pageLimit: 100,
    schedule,
    httpConcurrency: null,
    browserConcurrency: null
  }).id
}

function createOtherSource(database: LociDatabase): string {
  return database.createSource({
    name: 'React',
    url: 'https://react.dev',
    mode: 'http',
    pageLimit: 100,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  }).id
}

function crawlProgress(processed: number) {
  return {
    queued: 3,
    processed,
    succeeded: processed,
    failed: 0,
    limitReached: false
  }
}

function sourceCommit(
  sourceId: string,
  jobId: string,
  runId: string,
  owner: string
): SourceCrawlCommit {
  const result = {
    queued: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
    limitReached: false
  }
  return {
    documents: [
      {
        sourceId,
        url: 'https://vite.dev/guide',
        title: 'Guide',
        markdown: '# Guide',
        language: 'en',
        fetchMode: 'http' as const,
        crawledAt: '2026-08-25T00:00:00.000Z'
      }
    ],
    deletedUrls: [],
    replaceAll: false,
    localJob: { id: jobId, owner, runId, result },
    resolution: {
      firstUrl: 'https://vite.dev',
      mode: 'http' as const,
      iconUrl: null,
      discovery: 'pages' as const
    }
  }
}
