import {
  APP_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds
} from './settings-policy.js'

export interface ServerCrawlSettingValues {
  maxConcurrentJobs: number
  httpConcurrency: number
  browserConcurrency: number
  batchIntervalMinSeconds: number
  batchIntervalMaxSeconds: number
}

export interface ServerCrawlSettings extends ServerCrawlSettingValues {
  revision: number
  updatedAt: string
}

export interface SaveServerCrawlSettingsInput extends ServerCrawlSettingValues {
  revision: number
}

export const DEFAULT_SERVER_CRAWL_SETTINGS: ServerCrawlSettingValues = {
  maxConcurrentJobs: 3,
  httpConcurrency: 9,
  browserConcurrency: 5,
  batchIntervalMinSeconds: 0,
  batchIntervalMaxSeconds: 0
}

export const SERVER_CRAWL_SETTINGS_LIMITS = {
  maxConcurrentJobs: APP_SETTINGS_LIMITS.concurrency,
  concurrency: APP_SETTINGS_LIMITS.concurrency,
  batchIntervalSeconds: APP_SETTINGS_LIMITS.batchIntervalSeconds
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
  validateInteger(
    input.httpConcurrency,
    'HTTP 并发',
    SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min,
    SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max
  )
  validateInteger(
    input.browserConcurrency,
    '浏览器并发',
    SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min,
    SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max
  )
  if (
    !isValidBatchIntervalSeconds(input.batchIntervalMinSeconds) ||
    !isValidBatchIntervalSeconds(input.batchIntervalMaxSeconds) ||
    !isValidBatchIntervalRange(input.batchIntervalMinSeconds, input.batchIntervalMaxSeconds)
  ) {
    throw new Error('批次间隔必须为 0，或有效范围内且最小值不大于最大值')
  }
  return { ...input }
}

export function hasSameServerCrawlSettingValues(
  current: ServerCrawlSettingValues,
  input: ServerCrawlSettingValues
): boolean {
  return (
    current.maxConcurrentJobs === input.maxConcurrentJobs &&
    current.httpConcurrency === input.httpConcurrency &&
    current.browserConcurrency === input.browserConcurrency &&
    current.batchIntervalMinSeconds === input.batchIntervalMinSeconds &&
    current.batchIntervalMaxSeconds === input.batchIntervalMaxSeconds
  )
}

function validateInteger(value: number, label: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
}
