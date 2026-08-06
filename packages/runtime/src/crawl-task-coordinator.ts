import type { CrawlProgress } from '@loci/shared'

type ProgressListener = (progress: CrawlProgress) => void

interface ActiveCrawlTask {
  promise: Promise<CrawlProgress>
  listeners: Set<ProgressListener>
  latest: CrawlProgress | undefined
}

/** 同一进程内按文档源复用抓取 Promise，并把后加入调用者接到同一进度流。 */
export class CrawlTaskCoordinator {
  readonly #tasks = new Map<string, ActiveCrawlTask>()

  run(
    sourceId: string,
    start: (onProgress: ProgressListener) => Promise<CrawlProgress>,
    onProgress?: ProgressListener
  ): Promise<CrawlProgress> {
    const active = this.#tasks.get(sourceId)
    if (active) {
      if (onProgress) {
        active.listeners.add(onProgress)
        if (active.latest) onProgress(active.latest)
      }
      return active.promise
    }

    const listeners = new Set<ProgressListener>()
    if (onProgress) listeners.add(onProgress)
    const task: ActiveCrawlTask = {
      listeners,
      latest: undefined,
      promise: Promise.resolve().then(() =>
        start((progress) => {
          task.latest = progress
          for (const listener of task.listeners) notify(listener, progress)
        })
      )
    }
    this.#tasks.set(sourceId, task)
    const cleanup = (): void => {
      if (this.#tasks.get(sourceId) === task) this.#tasks.delete(sourceId)
    }
    void task.promise.then(cleanup, cleanup)
    return task.promise
  }

  isRunning(sourceId: string): boolean {
    return this.#tasks.has(sourceId)
  }
}

function notify(listener: ProgressListener, progress: CrawlProgress): void {
  try {
    listener(progress)
  } catch (error) {
    console.error('抓取进度回调失败', error)
  }
}
