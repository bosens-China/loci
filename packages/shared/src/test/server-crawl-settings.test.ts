import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVER_CRAWL_SETTINGS,
  hasSameServerCrawlSettingValues,
  normalizeServerCrawlSettingsInput
} from '../server-crawl-settings.js'

describe('Server 抓取策略', () => {
  it('接受共享默认值并保留修订号', () => {
    expect(
      normalizeServerCrawlSettingsInput({ ...DEFAULT_SERVER_CRAWL_SETTINGS, revision: 1 })
    ).toEqual({ ...DEFAULT_SERVER_CRAWL_SETTINGS, revision: 1 })
  })

  it('拒绝无效并发与反向间隔', () => {
    expect(() =>
      normalizeServerCrawlSettingsInput({
        ...DEFAULT_SERVER_CRAWL_SETTINGS,
        maxConcurrentJobs: 0,
        revision: 1
      })
    ).toThrow('最大并行任务数')
    expect(() =>
      normalizeServerCrawlSettingsInput({
        ...DEFAULT_SERVER_CRAWL_SETTINGS,
        batchIntervalMinSeconds: 300,
        batchIntervalMaxSeconds: 100,
        revision: 1
      })
    ).toThrow('批次间隔')
  })

  it('比较设置值时忽略修订元数据', () => {
    expect(
      hasSameServerCrawlSettingValues(DEFAULT_SERVER_CRAWL_SETTINGS, {
        ...DEFAULT_SERVER_CRAWL_SETTINGS
      })
    ).toBe(true)
  })
})
