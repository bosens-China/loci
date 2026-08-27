import { APP_SETTINGS_LIMITS } from '@loci/shared'
import { CliError } from '../errors.js'
import { parseBatchIntervalRange } from './config.js'

export function parseDomainConcurrency(
  value: string | undefined,
  fallback: number | null
): number | null {
  if (value === undefined) return fallback
  if (value === 'default') return null
  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < APP_SETTINGS_LIMITS.concurrency.min ||
    parsed > APP_SETTINGS_LIMITS.concurrency.max
  ) {
    throw new CliError(`并发数必须是 1–${APP_SETTINGS_LIMITS.concurrency.max} 的整数或 default`, 2)
  }
  return parsed
}

export function parseDomainInterval(
  value: string | undefined,
  current:
    { batchIntervalMinSeconds: number | null; batchIntervalMaxSeconds: number | null } | undefined
): [number | null, number | null] {
  if (value === undefined) {
    return [current?.batchIntervalMinSeconds ?? null, current?.batchIntervalMaxSeconds ?? null]
  }
  if (value === 'default') return [null, null]
  return parseBatchIntervalRange(value)
}

export function formatDomainInterval(minimum: number | null, maximum: number | null): string {
  if (minimum === null) return '默认'
  if (maximum === null || minimum === maximum) return `${minimum}s`
  return `${minimum}-${maximum}s`
}
