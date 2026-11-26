import { createHash } from 'node:crypto'
import { normalizeUrl } from '@loci/core'
import type { CrawlProgress, LibraryCrawlStatus } from '@loci/shared'
import { RuntimeLockedError } from './runtime-lock.js'

type ProgressListener = (progress: CrawlProgress) => void

interface ActiveCrawlTask {
  promise: Promise<CrawlProgress>
  listeners: Set<ProgressListener>
  latest: CrawlProgress | undefined
  requestKey?: string
}

/** 保留无效输入供抓取层报告，并让同一组有效页面在不同入口生成同一个键。 */
export function crawlRequestKey(
  kind: LibraryCrawlStatus['kind'],
  urls: readonly string[] = []
): string {
  const normalized = urls.map((url) => {
    try {
      return normalizeUrl(url)
    } catch {
      return url
    }
  })
  return createHash('sha256')
    .update(JSON.stringify([kind, [...new Set(normalized)].sort()]))
    .digest('hex')
}

/** 同一进程内按文档源复用抓取 Promise，并把后加入调用者接到同一进度流。 */
export class CrawlTaskCoordinator {
  readonly #tasks = new Map<string, ActiveCrawlTask>()

  run(
    sourceId: string,
    start: (onProgress: ProgressListener) => Promise<CrawlProgress>,
    onProgress?: ProgressListener,
    signal?: AbortSignal,
    requestKey?: string
  ): Promise<CrawlProgress> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const active = this.#tasks.get(sourceId)
    if (active) {
      if (active.requestKey !== requestKey)
        return Promise.reject(new RuntimeLockedError('文档库已有其他抓取正在运行', null))
      if (onProgress) {
        active.listeners.add(onProgress)
        if (active.latest) notify(onProgress, active.latest)
      }
      if (!signal) return active.promise
      // 跟随者取消只解除自己的订阅，任务持有者仍可完成抓取。
      return new Promise((resolve, reject) => {
        const detach = () => {
          signal.removeEventListener('abort', cancel)
          if (onProgress) active.listeners.delete(onProgress)
        }
        const cancel = () => {
          detach()
          reject(signal.reason)
        }
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
        void active.promise.then(
          (value) => {
            detach()
            resolve(value)
          },
          (error) => {
            detach()
            reject(error)
          }
        )
      })
    }

    const listeners = new Set<ProgressListener>()
    if (onProgress) listeners.add(onProgress)
    const task: ActiveCrawlTask = {
      listeners,
      requestKey,
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
