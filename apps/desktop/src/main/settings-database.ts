import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings } from '@loci/shared'
import { validateSettings } from './database-values'

export interface SettingsDatabase {
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => AppSettings
}

export function createSettingsDatabase(database: DatabaseSync): SettingsDatabase {
  return {
    getSettings: () => {
      const row = database
        .prepare(
          'SELECT mcp_port, theme, http_concurrency, browser_concurrency, server_url FROM app_settings WHERE id = 1'
        )
        .get() as unknown as SettingsRow
      return {
        mcpPort: Number(row.mcp_port),
        theme: row.theme,
        httpConcurrency: Number(row.http_concurrency),
        browserConcurrency: Number(row.browser_concurrency),
        serverUrl: row.server_url
      }
    },
    saveSettings: (settings) => {
      const normalized = validateSettings(settings)
      database
        .prepare(
          `UPDATE app_settings
           SET mcp_port = ?, theme = ?, http_concurrency = ?, browser_concurrency = ?, server_url = ?
           WHERE id = 1`
        )
        .run(
          normalized.mcpPort,
          normalized.theme,
          normalized.httpConcurrency,
          normalized.browserConcurrency,
          normalized.serverUrl
        )
      return normalized
    }
  }
}

interface SettingsRow {
  mcp_port: number
  theme: AppSettings['theme']
  http_concurrency: number
  browser_concurrency: number
  server_url: string
}
