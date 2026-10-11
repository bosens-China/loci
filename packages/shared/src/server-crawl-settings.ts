import { APP_SETTINGS_LIMITS } from './settings-policy.js'

export interface ServerCrawlSettingValues {
  maxConcurrentJobs: number
}

export interface ServerCrawlSettings extends ServerCrawlSettingValues {
  revision: number
  updatedAt: string
}

export interface SaveServerCrawlSettingsInput extends ServerCrawlSettingValues {
  revision: number
}

export const DEFAULT_SERVER_CRAWL_SETTINGS: ServerCrawlSettingValues = {
  maxConcurrentJobs: 3
}

export const SERVER_CRAWL_SETTINGS_LIMITS = {
  maxConcurrentJobs: APP_SETTINGS_LIMITS.concurrency
} as const

/** 所有管理入口共用同一份 Server 抓取策略校验，避免各端边界漂移。 */
export function normalizeServerCrawlSettingsInput(
  input: SaveServerCrawlSettingsInput
): SaveServerCrawlSettingsInput {
  validateInteger(input.revision, '配置修订号', 1, Number.MAX_SAFE_INTEGER)
  validateInteger(
    input.maxConcurrentJobs,
    '最大并行任务数',
    SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.min,
    SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.max
  )
  return { maxConcurrentJobs: input.maxConcurrentJobs, revision: input.revision }
}

export function hasSameServerCrawlSettingValues(
  current: ServerCrawlSettingValues,
  input: ServerCrawlSettingValues
): boolean {
  return current.maxConcurrentJobs === input.maxConcurrentJobs
}

function validateInteger(value: number, label: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
}
