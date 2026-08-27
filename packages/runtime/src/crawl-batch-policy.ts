import type { CrawlBatchPolicy } from '@loci/core'
import { randomIntervalSeconds, type AppSettings, type HostnameCrawlPolicy } from '@loci/shared'

interface PolicyDatabase {
  getSettings: () => AppSettings
  getHostnameCrawlPolicy: (hostname: string) => HostnameCrawlPolicy | undefined
}

interface CrawlPolicySource {
  hostname: string
  httpConcurrency: number | null
  browserConcurrency: number | null
}

/** 每一批次重新读取域名策略，使设置修改无需重启 worker 即可生效。 */
export function resolveCrawlBatchPolicy(
  database: PolicyDatabase,
  source: CrawlPolicySource,
  fetchMode: 'auto' | 'http' | 'browser',
  random: () => number = Math.random
): CrawlBatchPolicy {
  const settings = database.getSettings()
  const policy = database.getHostnameCrawlPolicy(source.hostname)
  const browser = fetchMode === 'browser'
  const concurrency = browser
    ? (policy?.browserConcurrency ?? source.browserConcurrency ?? settings.browserConcurrency)
    : (policy?.httpConcurrency ?? source.httpConcurrency ?? settings.httpConcurrency)
  const hasDomainInterval = Boolean(
    policy && (policy.batchIntervalMinSeconds !== null || policy.batchIntervalMaxSeconds !== null)
  )
  const minimum = hasDomainInterval
    ? (policy?.batchIntervalMinSeconds ?? 0)
    : settings.batchIntervalSeconds
  const maximum = hasDomainInterval
    ? (policy?.batchIntervalMaxSeconds ?? 0)
    : settings.batchIntervalMaxSeconds
  return {
    concurrency,
    batchIntervalMs: randomIntervalSeconds(minimum, maximum, random) * 1000
  }
}

export { randomIntervalSeconds }
