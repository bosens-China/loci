import type { CrawlProgress } from '@loci/core'
import type { LociDatabase } from './database.js'

export interface LocalJobReference {
  id: string
  owner: string
}

export interface LocalJobProgressWriter {
  report: (progress: CrawlProgress, pendingUrls: string[], contentBytes: number) => void
  checkpoint: (progress: CrawlProgress, pendingUrls: string[], contentBytes: number) => void
}

/**
 * 未知总量阶段和总数变化立即落盘；确定总量后的逐批进度由 checkpoint 落盘。
 * 这样任务中心能看到真实阶段，同时避免每个节点的开始、结束都写 SQLite。
 */
export function createLocalJobProgressWriter(
  database: LociDatabase,
  job?: LocalJobReference
): LocalJobProgressWriter {
  let lastQueued = -1
  let lastUnknownStage = ''

  const persist = (
    progress: CrawlProgress,
    pendingUrls: string[],
    contentBytes: number,
    force: boolean
  ): void => {
    if (!job) return
    const unknownStage =
      progress.queued === 0
        ? [progress.node?.id, progress.node?.title, progress.node?.status].join('|')
        : ''
    if (!force && progress.queued === lastQueued && unknownStage === lastUnknownStage) {
      return
    }
    if (database.checkpointLocalJob(job.id, job.owner, progress, pendingUrls, contentBytes)) {
      lastQueued = progress.queued
      lastUnknownStage = unknownStage
    }
  }

  return {
    report: (progress, pendingUrls, contentBytes) =>
      persist(progress, pendingUrls, contentBytes, false),
    checkpoint: (progress, pendingUrls, contentBytes) =>
      persist(progress, pendingUrls, contentBytes, true)
  }
}
