import { DEFAULT_APP_SETTINGS, type AppSettings } from '@loci/shared'
import { eq } from 'drizzle-orm'
import { validateSettings } from './database-values.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { appSettings } from './drizzle-schema.js'

export interface SettingsDatabase {
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => AppSettings
}

export function initializeSettings(database: LociDrizzleDatabase): void {
  database
    .insert(appSettings)
    .values({ id: 1, ...DEFAULT_APP_SETTINGS })
    .onConflictDoNothing()
    .run()
}

/** 单行设置使用固定主键，多个本地入口共享已提交的配置。 */
export function createSettingsDatabase(database: LociDrizzleDatabase): SettingsDatabase {
  return {
    getSettings() {
      const row = database.select().from(appSettings).where(eq(appSettings.id, 1)).get()
      if (!row) throw new Error('应用设置不存在')
      return {
        theme: row.theme,
        httpConcurrency: row.httpConcurrency,
        browserConcurrency: row.browserConcurrency,
        maxRetries: row.maxRetries,
        batchIntervalSeconds: row.batchIntervalSeconds,
        batchIntervalMaxSeconds: row.batchIntervalMaxSeconds,
        githubArchiveLimitMb: row.githubArchiveLimitMb,
        githubMarkdownLimitMb: row.githubMarkdownLimitMb
      }
    },
    saveSettings(settings) {
      const normalized = validateSettings(settings)
      database.update(appSettings).set(normalized).where(eq(appSettings.id, 1)).run()
      return normalized
    }
  }
}
