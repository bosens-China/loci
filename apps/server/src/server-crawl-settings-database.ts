import {
  hasSameServerCrawlSettingValues,
  normalizeServerCrawlSettingsInput,
  type SaveServerCrawlSettingsInput,
  type ServerCrawlSettings
} from '@loci/shared'
import { and, eq, sql } from 'drizzle-orm'
import { ConflictError } from './database-errors.js'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { serverCrawlSettings } from './drizzle-schema.js'

export interface ServerCrawlSettingsDatabase {
  get: () => ServerCrawlSettings
  save: (input: SaveServerCrawlSettingsInput) => ServerCrawlSettings
}

/** 单行配置使用 revision 做 CAS；相同内容的并发重试视为幂等成功。 */
export function createServerCrawlSettingsDatabase(
  database: ServerDrizzleDatabase
): ServerCrawlSettingsDatabase {
  const get = (): ServerCrawlSettings => {
    const current = database
      .select()
      .from(serverCrawlSettings)
      .where(eq(serverCrawlSettings.id, 1))
      .get()
    if (!current) throw new Error('Server 抓取策略尚未初始化')
    return current
  }

  return {
    get,
    save: (input) => {
      const normalized = normalizeServerCrawlSettingsInput(input)
      const updatedAt = new Date().toISOString()
      const result = database
        .update(serverCrawlSettings)
        .set({
          maxConcurrentJobs: normalized.maxConcurrentJobs,
          httpConcurrency: normalized.httpConcurrency,
          browserConcurrency: normalized.browserConcurrency,
          batchIntervalMinSeconds: normalized.batchIntervalMinSeconds,
          batchIntervalMaxSeconds: normalized.batchIntervalMaxSeconds,
          revision: sql`${serverCrawlSettings.revision} + 1`,
          updatedAt
        })
        .where(
          and(eq(serverCrawlSettings.id, 1), eq(serverCrawlSettings.revision, normalized.revision))
        )
        .run()
      const current = get()
      if (result.changes > 0 || hasSameServerCrawlSettingValues(current, normalized)) return current
      throw new ConflictError('Server 抓取策略已被其他管理员修改，请刷新后重试')
    }
  }
}
