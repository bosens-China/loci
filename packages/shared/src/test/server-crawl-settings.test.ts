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

  it('拒绝无效任务容量与修订号', () => {
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
        revision: 0
      })
    ).toThrow('配置修订号')
  })

  it('比较设置值时忽略修订元数据', () => {
    expect(
      hasSameServerCrawlSettingValues(DEFAULT_SERVER_CRAWL_SETTINGS, {
        ...DEFAULT_SERVER_CRAWL_SETTINGS
      })
    ).toBe(true)
  })
})
