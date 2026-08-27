import type { SaveHostnameCrawlPolicyInput } from './api.js'
import {
  APP_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds
} from './settings-policy.js'

export function normalizeHostnamePolicyInput(
  input: SaveHostnameCrawlPolicyInput
): SaveHostnameCrawlPolicyInput {
  const hostname = normalizeHostname(input.hostname)
  validateConcurrency(input.httpConcurrency, 'HTTP 并发')
  validateConcurrency(input.browserConcurrency, '浏览器并发')
  validateInterval(input.batchIntervalMinSeconds, '最小批次间隔')
  validateInterval(input.batchIntervalMaxSeconds, '最大批次间隔')
  if (
    !isValidBatchIntervalRange(
      input.batchIntervalMinSeconds ?? 0,
      input.batchIntervalMaxSeconds ?? 0
    )
  ) {
    throw new Error('域名批次间隔最大值不能小于最小值')
  }
  return { ...input, hostname }
}

export function normalizePolicyHostname(value: string): string {
  return normalizeHostname(value)
}

export function randomIntervalSeconds(
  minimum: number,
  maximum: number,
  random: () => number = Math.random
): number {
  if (minimum === 0 && maximum === 0) return 0
  if (minimum === 0) return maximum
  if (maximum === 0 || minimum === maximum) return minimum
  return minimum + Math.floor(random() * (maximum - minimum + 1))
}

function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase()
  if (!hostname || hostname.includes('/') || hostname.includes(':')) {
    throw new Error('域名格式不正确')
  }
  try {
    if (new URL(`https://${hostname}`).hostname !== hostname) throw new Error()
  } catch {
    throw new Error('域名格式不正确')
  }
  return hostname
}

function validateConcurrency(value: number | null, label: string): void {
  if (value === null) return
  if (
    !Number.isInteger(value) ||
    value < APP_SETTINGS_LIMITS.concurrency.min ||
    value > APP_SETTINGS_LIMITS.concurrency.max
  ) {
    throw new Error(`${label}必须在 1 到 ${APP_SETTINGS_LIMITS.concurrency.max} 之间`)
  }
}

function validateInterval(value: number | null, label: string): void {
  if (value !== null && !isValidBatchIntervalSeconds(value)) {
    throw new Error(`${label}超出允许范围`)
  }
}
