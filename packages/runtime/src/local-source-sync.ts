import type { CrawlProgress, LocalJobEvent } from '@loci/shared'
import type { BrowserInstallPrompt } from './browser-crawler.js'
import type { LocalJobTrigger } from './local-job-database.js'
import { createLocalJobRunner } from './local-job-runner.js'
import type { LocalRuntime } from './local-runtime.js'

export interface LocalSourceSyncOptions {
  trigger: LocalJobTrigger
  onProgress?: (progress: CrawlProgress) => void
  onBrowserMissing?: BrowserInstallPrompt
  signal?: AbortSignal
}

/** 前台入口也先写持久队列，再由同一个 worker 执行并等待持久结果。 */
export async function runLocalSourceSync(
  runtime: LocalRuntime,
  sourceId: string,
  options: LocalSourceSyncOptions
): Promise<CrawlProgress> {
  const runner = createLocalJobRunner(runtime, {
    owner: `foreground-${process.pid}`,
    onBrowserMissing: options.onBrowserMissing
  })
  try {
    const task = runDurableSourceSync(
      runtime,
      sourceId,
      options.trigger,
      options.onProgress,
      options.signal
    )
    runner.start()
    return await task
  } finally {
    await runner.stop()
  }
}

export async function runDurableSourceSync(
  runtime: LocalRuntime,
  sourceId: string,
  trigger: LocalJobTrigger,
  onProgress?: (progress: CrawlProgress) => void,
  signal?: AbortSignal
): Promise<CrawlProgress> {
  const { job, reused } = runtime.database.enqueueSourceSync(sourceId, trigger)
  let afterSequence = 0
  let reportedProcessed = -1
  const cancelOwnedTask = (): void => {
    if (!reused) runtime.database.requestLocalJobCancellation(job.id)
  }
  if (signal?.aborted) cancelOwnedTask()
  signal?.addEventListener('abort', cancelOwnedTask, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      let events: LocalJobEvent[]
      do {
        events = runtime.database.listLocalJobEvents(job.id, afterSequence, 500)
        for (const event of events) {
          afterSequence = event.sequence
          reportedProcessed = event.progress.processed
          onProgress?.(event.progress)
        }
      } while (events.length === 500)
      const current = runtime.database.getLocalJob(job.id)
      if (!current) throw new Error('后台同步任务不存在')
      if (current.status === 'completed') {
        if (!current.result) throw new Error('后台同步完成，但没有找到运行结果')
        if (current.result.processed !== reportedProcessed) onProgress?.(current.result)
        return current.result
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        throw new Error(
          current.error ?? (current.status === 'cancelled' ? '同步已取消' : '同步失败')
        )
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
  } finally {
    signal?.removeEventListener('abort', cancelOwnedTask)
  }
}
