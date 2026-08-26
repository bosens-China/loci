import { setTimeout as delay } from 'node:timers/promises'
import { acquireCrawlRuntimeLock, RuntimeLockedError, type RuntimeLock } from './runtime-lock.js'

interface UrlReviewLockOptions {
  dataDir: string
  sourceId: string
  owner: string
  signal?: AbortSignal
  shouldContinue: () => boolean
}

/** 等待已有 owner 退出后重新竞争锁；调用方可通过持久状态停止等待。 */
export async function acquireUrlReviewRuntimeLock(
  options: UrlReviewLockOptions
): Promise<RuntimeLock | undefined> {
  while (true) {
    options.signal?.throwIfAborted()
    if (!options.shouldContinue()) return undefined
    try {
      return acquireCrawlRuntimeLock(options.dataDir, options.sourceId, `${options.owner} URL 审查`)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) throw error
      await delay(20, undefined, { signal: options.signal })
    }
  }
}
