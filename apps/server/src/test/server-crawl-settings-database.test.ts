import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVER_CRAWL_SETTINGS } from '@loci/shared'
import { ConflictError, ServerDatabase } from '../database.js'
import { initializeServerDatabase } from '../database-schema.js'

describe('Server 抓取策略数据库', () => {
  it('重复初始化清理废弃配置列并保留任务容量与修订号', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`CREATE TABLE server_crawl_settings (
        id INTEGER PRIMARY KEY, max_concurrent_jobs INTEGER NOT NULL,
        http_concurrency INTEGER NOT NULL, browser_concurrency INTEGER NOT NULL,
        batch_interval_min_seconds INTEGER NOT NULL, batch_interval_max_seconds INTEGER NOT NULL,
        revision INTEGER NOT NULL, updated_at TEXT NOT NULL
      ); INSERT INTO server_crawl_settings VALUES (1, 7, 9, 5, 0, 0, 4, 'saved');`)
      initializeServerDatabase(database)
      initializeServerDatabase(database)
      expect({ ...database.prepare('SELECT * FROM server_crawl_settings').get() }).toEqual({
        id: 1,
        max_concurrent_jobs: 7,
        revision: 4,
        updated_at: 'saved'
      })
    } finally {
      database.close()
    }
  })

  it('初始化共享默认值并持久化更新', () => {
    const database = new ServerDatabase(':memory:')
    try {
      const initial = database.crawlSettings.get()
      expect(initial).toMatchObject({ ...DEFAULT_SERVER_CRAWL_SETTINGS, revision: 1 })
      expect(database.crawlSettings.save({ ...initial, maxConcurrentJobs: 4 })).toMatchObject({
        maxConcurrentJobs: 4,
        revision: 2
      })
    } finally {
      database.close()
    }
  })

  it('跨连接更新使用修订号防止静默覆盖并允许相同内容重试', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-server-settings-'))
    const filename = join(directory, 'server.sqlite')
    const first = new ServerDatabase(filename)
    const second = new ServerDatabase(filename)
    try {
      const baseline = first.crawlSettings.get()
      const input = { ...baseline, maxConcurrentJobs: 4 }
      const saved = first.crawlSettings.save(input)

      expect(second.crawlSettings.save(input)).toEqual(saved)
      expect(() => second.crawlSettings.save({ ...baseline, maxConcurrentJobs: 8 })).toThrow(
        ConflictError
      )
      expect(second.crawlSettings.get()).toEqual(saved)
    } finally {
      first.close()
      second.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
