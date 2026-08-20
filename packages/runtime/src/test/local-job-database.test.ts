import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type LociDatabase } from '../database.js'

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

  it('恢复过期任务，并在连续中断后停止重试', () => {
    const database = createMemoryDatabase()
    try {
      const sourceId = createSource(database, null)
      let now = new Date('2026-08-20T00:00:00.000Z')
      const job = database.enqueueSourceSync(sourceId, 'manual', now).job

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claimed = database.claimNextLocalJob(`worker-${attempt}`, 1_000, now)
        expect(claimed?.attemptCount).toBe(attempt)
        now = new Date(now.getTime() + 2_000)
      }

      expect(database.claimNextLocalJob('worker-4', 1_000, now)).toBeUndefined()
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'failed',
        error: '后台任务连续中断，已停止自动重试'
      })
    } finally {
      database.close()
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
