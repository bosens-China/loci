import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerDatabase } from '../database.js'
import { getServerBatchPolicy } from '../sync-job-runner.js'

afterEach(() => vi.restoreAllMocks())

describe('Server 批次抓取策略', () => {
  it('使用全局默认并由 hostname 的非空字段覆盖', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const database = new ServerDatabase(':memory:')
    try {
      const initial = database.crawlSettings.get()
      database.crawlSettings.save({
        ...initial,
        httpConcurrency: 8,
        browserConcurrency: 4,
        batchIntervalMinSeconds: 100,
        batchIntervalMaxSeconds: 300
      })
      expect(getServerBatchPolicy(database, 'docs.example.com', 'http')).toEqual({
        concurrency: 8,
        batchIntervalMs: 100_000
      })

      database.hostnamePolicies.save({
        hostname: 'docs.example.com',
        httpConcurrency: 2,
        browserConcurrency: null,
        batchIntervalMinSeconds: 200,
        batchIntervalMaxSeconds: 200
      })
      expect(getServerBatchPolicy(database, 'docs.example.com', 'http')).toEqual({
        concurrency: 2,
        batchIntervalMs: 200_000
      })
      expect(getServerBatchPolicy(database, 'docs.example.com', 'browser')).toEqual({
        concurrency: 4,
        batchIntervalMs: 200_000
      })
    } finally {
      database.close()
    }
  })
})
