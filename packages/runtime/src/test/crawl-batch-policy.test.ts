import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '@loci/shared'
import { randomIntervalSeconds, resolveCrawlBatchPolicy } from '../crawl-batch-policy.js'
import { createDatabase } from '../database.js'

describe('域名抓取策略', () => {
  it('单个批次间隔作为固定值，区间值落在闭区间', () => {
    expect(randomIntervalSeconds(120, 0)).toBe(120)
    expect(randomIntervalSeconds(0, 180)).toBe(180)
    expect(randomIntervalSeconds(100, 300, () => 0)).toBe(100)
    expect(randomIntervalSeconds(100, 300, () => 0.999)).toBe(300)
  })

  it('域名策略覆盖来源与全局设置', () => {
    const policy = resolveCrawlBatchPolicy(
      {
        getSettings: () => ({
          ...DEFAULT_APP_SETTINGS,
          httpConcurrency: 9,
          batchIntervalSeconds: 100,
          batchIntervalMaxSeconds: 300
        }),
        getHostnameCrawlPolicy: () => ({
          hostname: 'docs.example.com',
          httpConcurrency: 2,
          browserConcurrency: null,
          batchIntervalMinSeconds: 200,
          batchIntervalMaxSeconds: 400,
          updatedAt: new Date(0).toISOString()
        })
      },
      {
        hostname: 'docs.example.com',
        httpConcurrency: 5,
        browserConcurrency: 3
      },
      'http',
      () => 0.5
    )

    expect(policy).toEqual({ concurrency: 2, batchIntervalMs: 300_000 })
  })

  it('保存后由下一次策略读取实时生效，删除后恢复继承', () => {
    const database = createDatabase(':memory:')
    const source = {
      hostname: 'docs.example.com',
      httpConcurrency: null,
      browserConcurrency: null
    }
    try {
      database.saveHostnameCrawlPolicy({
        hostname: source.hostname,
        httpConcurrency: 2,
        browserConcurrency: null,
        batchIntervalMinSeconds: 200,
        batchIntervalMaxSeconds: null
      })
      expect(resolveCrawlBatchPolicy(database, source, 'http')).toEqual({
        concurrency: 2,
        batchIntervalMs: 200_000
      })
      expect(database.listHostnameCrawlPolicies()).toHaveLength(1)

      expect(database.deleteHostnameCrawlPolicy(source.hostname)).toBe(true)
      expect(resolveCrawlBatchPolicy(database, source, 'http').concurrency).toBe(
        DEFAULT_APP_SETTINGS.httpConcurrency
      )
    } finally {
      database.close()
    }
  })
})
