import { DOCUMENT_SOURCE_LIMITS } from './source-policy.js'

/** CLI、Web UI、后台服务和备份协议共享的设置边界。 */
export const APP_SETTINGS_LIMITS = {
  mcpPort: { min: 1024, max: 65_535 },
  concurrency: DOCUMENT_SOURCE_LIMITS.concurrency,
  maxRetries: { min: 0, max: 10 },
  batchIntervalSeconds: { disabled: 0, min: 100, max: 3000 },
  githubSizeMb: DOCUMENT_SOURCE_LIMITS.githubSizeMb
} as const

export function isValidBatchIntervalSeconds(value: unknown): value is number {
  const limits = APP_SETTINGS_LIMITS.batchIntervalSeconds
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (value === limits.disabled || (value >= limits.min && value <= limits.max))
  )
}
