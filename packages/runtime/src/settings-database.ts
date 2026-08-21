import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_APP_SETTINGS,
  DEVELOPMENT_SERVER_URL,
  normalizeServerUrl,
  PRODUCTION_SERVER_URL,
  type AppSettings
} from '@loci/shared'
import { validateSettings } from './database-values.js'

export interface SettingsDatabase {
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => AppSettings
}

export interface SettingsInitializationOptions {
  serverUrl?: string
  overrideServerUrl?: boolean
}

/** 初始化新设置，并将旧正式版的本地默认地址迁移到生产域名。 */
export function initializeSettings(
  database: DatabaseSync,
  options: SettingsInitializationOptions = {}
): void {
  const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_APP_SETTINGS.serverUrl)
  database
    .prepare(
      `INSERT OR IGNORE INTO app_settings
       (id, theme, http_concurrency, browser_concurrency, max_retries,
        batch_interval_seconds, server_url, server_url_customized, github_archive_limit_mb,
        github_markdown_limit_mb)
       VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      DEFAULT_APP_SETTINGS.theme,
      DEFAULT_APP_SETTINGS.httpConcurrency,
      DEFAULT_APP_SETTINGS.browserConcurrency,
      DEFAULT_APP_SETTINGS.maxRetries,
      DEFAULT_APP_SETTINGS.batchIntervalSeconds,
      serverUrl,
      DEFAULT_APP_SETTINGS.githubArchiveLimitMb,
      DEFAULT_APP_SETTINGS.githubMarkdownLimitMb
    )
  if (!options.overrideServerUrl && serverUrl === PRODUCTION_SERVER_URL) {
    database
      .prepare(
        `UPDATE app_settings SET server_url = ?
         WHERE id = 1 AND server_url = ? AND server_url_customized = 0`
      )
      .run(PRODUCTION_SERVER_URL, DEVELOPMENT_SERVER_URL)
  }
}

export function createSettingsDatabase(
  database: DatabaseSync,
  serverUrlOverride?: string
): SettingsDatabase {
  return {
    getSettings: () => {
      const row = database
        .prepare(
          `SELECT theme, http_concurrency, browser_concurrency, max_retries,
             batch_interval_seconds, server_url, github_archive_limit_mb,
             github_markdown_limit_mb FROM app_settings WHERE id = 1`
        )
        .get() as unknown as SettingsRow
      return {
        theme: row.theme,
        httpConcurrency: Number(row.http_concurrency),
        browserConcurrency: Number(row.browser_concurrency),
        maxRetries: Number(row.max_retries),
        batchIntervalSeconds: Number(row.batch_interval_seconds),
        serverUrl: serverUrlOverride ?? row.server_url,
        githubArchiveLimitMb: Number(row.github_archive_limit_mb),
        githubMarkdownLimitMb: Number(row.github_markdown_limit_mb)
      }
    },
    saveSettings: (settings) => {
      const normalized = validateSettings(settings)
      const persistedServerUrl = serverUrlOverride
        ? (
            database
              .prepare('SELECT server_url FROM app_settings WHERE id = 1')
              .get() as unknown as {
              server_url: string
            }
          ).server_url
        : normalized.serverUrl
      database
        .prepare(
          `UPDATE app_settings
           SET theme = ?, http_concurrency = ?, browser_concurrency = ?,
               max_retries = ?, batch_interval_seconds = ?,
               github_archive_limit_mb = ?, github_markdown_limit_mb = ?,
               server_url_customized = CASE WHEN server_url = ? THEN server_url_customized ELSE 1 END,
               server_url = ?
           WHERE id = 1`
        )
        .run(
          normalized.theme,
          normalized.httpConcurrency,
          normalized.browserConcurrency,
          normalized.maxRetries,
          normalized.batchIntervalSeconds,
          normalized.githubArchiveLimitMb,
          normalized.githubMarkdownLimitMb,
          persistedServerUrl,
          persistedServerUrl
        )
      return normalized
    }
  }
}

interface SettingsRow {
  theme: AppSettings['theme']
  http_concurrency: number
  browser_concurrency: number
  max_retries: number
  batch_interval_seconds: number
  server_url: string
  github_archive_limit_mb: number
  github_markdown_limit_mb: number
}
