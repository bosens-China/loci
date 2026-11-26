import { randomUUID } from 'node:crypto'
import type { ForegroundCrawlState, LibraryCrawlStatus } from '@loci/shared'
import type { LociDatabase } from './database.js'
import {
  acquireDatabaseWriteRuntimeLock,
  readRuntimeLock,
  RuntimeLockedError
} from './runtime-lock.js'

/** 只收口读到的运行 ID；持有来源锁后复核，避免与新任务启动或还原备份竞争。 */
export function createLibraryCrawlStatuses(
  db: LociDatabase,
  dataDir: string,
  localState: (
    id: string
  ) => (Pick<ForegroundCrawlState, 'progress'> & { runId: string }) | undefined
) {
  function getLibraryCrawlStatus(libraryId: string): LibraryCrawlStatus | null {
    let run = db.getLatestCrawlRun(libraryId)
    if (!run) return null
    const key = `crawl-${libraryId}`
    const holder = run.status === 'running' ? readRuntimeLock(dataDir, key) : null
    if (
      run.status === 'running' &&
      (!holder ||
        (holder.crawlRunId
          ? holder.crawlRunId !== run.id
          : run.startedAt && holder.startedAt > run.startedAt))
    ) {
      try {
        // 后来的编辑锁也可能占用同一个库。对旧运行 ID 做 CAS，无需阻塞新持有者。
        const recoveryKey = holder ? `write-${randomUUID()}` : key
        const lock = acquireDatabaseWriteRuntimeLock(dataDir, recoveryKey, '恢复中断的抓取记录')
        try {
          db.interruptCrawlRun(run.id)
        } finally {
          lock.release()
        }
      } catch (error) {
        if (!(error instanceof RuntimeLockedError)) throw error
      }
      run = db.getLatestCrawlRun(libraryId)
      if (!run) return null
    }
    const local = localState(libraryId)
    const progress =
      (local?.runId === run.id && run.status === 'running' ? local.progress : null) ?? run.progress
    let status: LibraryCrawlStatus['status']
    if (run.status === 'queued') return null
    if (run.status === 'failed' && run.cancelled) status = 'cancelled'
    else if (run.status === 'completed' && progress.failed) status = 'completed_with_errors'
    else status = run.status
    const failures =
      run.status === 'running' || !progress.failed
        ? []
        : db.listCrawlFailures(run.id, 20).map(({ url, message }) => ({ url, message }))
    return {
      ...(failures.length && { failures }),
      libraryId,
      runId: run.id,
      kind: run.kind,
      status,
      progress: {
        discovered: progress.queued,
        processed: progress.processed,
        succeeded: progress.succeeded,
        failed: progress.failed,
        currentUrl: progress.node?.url ?? run.currentUrl
      },
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error
    }
  }
  return {
    getLibraryCrawlStatus,
    listLibraryCrawlStatuses: () =>
      db.listCrawledSourceIds().flatMap((id) => getLibraryCrawlStatus(id) ?? [])
  }
}

export type LibraryCrawlStatuses = ReturnType<typeof createLibraryCrawlStatuses>
