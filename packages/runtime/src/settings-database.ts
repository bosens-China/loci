import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_APP_SETTINGS, normalizeServerUrl, type AppSettings } from '@loci/shared'
import { eq, sql } from 'drizzle-orm'
import { validateSettings } from './database-values.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { appSettings } from './drizzle-schema.js'

export interface SettingsDatabase {
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => AppSettings
}

export interface SettingsInitializationOptions {
  serverUrl?: string
  overrideServerUrl?: boolean
}

/** 初始化设置；未自定义的 Server 地址跟随当前运行环境默认值。 */
export function initializeSettings(
  database: DatabaseSync,
  options: SettingsInitializationOptions = {}
): void {
  const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_APP_SETTINGS.serverUrl)
  database
    .prepare(
      `INSERT OR IGNORE INTO app_settings
       (id, theme, http_concurrency, browser_concurrency, max_retries,
        batch_interval_seconds, batch_interval_max_seconds, server_url, server_url_customized, github_archive_limit_mb,
        github_markdown_limit_mb)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      DEFAULT_APP_SETTINGS.theme,
      DEFAULT_APP_SETTINGS.httpConcurrency,
      DEFAULT_APP_SETTINGS.browserConcurrency,
      DEFAULT_APP_SETTINGS.maxRetries,
      DEFAULT_APP_SETTINGS.batchIntervalSeconds,
      DEFAULT_APP_SETTINGS.batchIntervalMaxSeconds,
      serverUrl,
      DEFAULT_APP_SETTINGS.githubArchiveLimitMb,
      DEFAULT_APP_SETTINGS.githubMarkdownLimitMb
    )
  if (!options.overrideServerUrl) {
    database
      .prepare(
        `UPDATE app_settings SET server_url = ?
         WHERE id = 1 AND server_url_customized = 0 AND server_url <> ?`
      )
      .run(serverUrl, serverUrl)
  }
}

export function createSettingsDatabase(
  database: LociDrizzleDatabase,
  serverUrlOverride?: string
): SettingsDatabase {
  return {
    getSettings: () => {
      const row = database
        .select({
          theme: appSettings.theme,
          httpConcurrency: appSettings.httpConcurrency,
          browserConcurrency: appSettings.browserConcurrency,
          maxRetries: appSettings.maxRetries,
          batchIntervalSeconds: appSettings.batchIntervalSeconds,
          batchIntervalMaxSeconds: appSettings.batchIntervalMaxSeconds,
          serverUrl: appSettings.serverUrl,
          githubArchiveLimitMb: appSettings.githubArchiveLimitMb,
          githubMarkdownLimitMb: appSettings.githubMarkdownLimitMb
        })
        .from(appSettings)
        .where(eq(appSettings.id, 1))
        .get()
      if (!row) throw new Error('应用设置不存在')
      return {
        theme: row.theme,
        httpConcurrency: row.httpConcurrency,
        browserConcurrency: row.browserConcurrency,
        maxRetries: row.maxRetries,
        batchIntervalSeconds: row.batchIntervalSeconds,
        batchIntervalMaxSeconds: row.batchIntervalMaxSeconds,
        serverUrl: serverUrlOverride ?? row.serverUrl,
        githubArchiveLimitMb: row.githubArchiveLimitMb,
        githubMarkdownLimitMb: row.githubMarkdownLimitMb
      }
    },
    saveSettings: (settings) => {
      const normalized = validateSettings(settings)
      const persistedServerUrl = serverUrlOverride
        ? database
            .select({ serverUrl: appSettings.serverUrl })
            .from(appSettings)
            .where(eq(appSettings.id, 1))
            .get()?.serverUrl
        : normalized.serverUrl
      if (!persistedServerUrl) throw new Error('应用设置不存在')
      database
        .update(appSettings)
        .set({
          theme: normalized.theme,
          httpConcurrency: normalized.httpConcurrency,
          browserConcurrency: normalized.browserConcurrency,
          maxRetries: normalized.maxRetries,
          batchIntervalSeconds: normalized.batchIntervalSeconds,
          batchIntervalMaxSeconds: normalized.batchIntervalMaxSeconds,
          githubArchiveLimitMb: normalized.githubArchiveLimitMb,
          githubMarkdownLimitMb: normalized.githubMarkdownLimitMb,
          serverUrlCustomized: sql`CASE WHEN ${appSettings.serverUrl} = ${persistedServerUrl} THEN ${appSettings.serverUrlCustomized} ELSE 1 END`,
          serverUrl: persistedServerUrl
        })
        .where(eq(appSettings.id, 1))
        .run()
      return normalized
    }
  }
}
