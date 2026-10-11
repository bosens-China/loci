import { randomUUID } from 'node:crypto'
import { BasicCrawler, Configuration, Log, LogLevel } from '@crawlee/basic'
import { throwIfAborted } from './abort.js'

/** 执行参数留在共享底层；所有入口使用同一套资源和失败保护。 */
export const CRAWL_EXECUTION_DEFAULTS = {
  httpConcurrency: 9,
  browserConcurrency: 5,
  maxRetries: 3,
  timeoutMs: 30_000
} as const

interface CrawlTask {
  url: string
}

interface CrawlExecutorOptions<T extends CrawlTask> {
  tasks: readonly T[]
  concurrency?: number
  maxRetries?: number
  signal?: AbortSignal
  beforeRequest?: () => Promise<void>
  onCheckpoint?: (urls: string[]) => Promise<void> | void
  onRetry?: (error: Error) => Promise<void>
  handle: (task: T, enqueue: (task: T) => Promise<void>) => Promise<void>
  onFailure: (task: T, error: Error) => Promise<void>
}

/** Crawlee 只管理本次执行队列；SQLite 是跨进程任务和恢复状态的唯一持久化来源。 */
export async function executeCrawlTasks<T extends CrawlTask>(
  options: CrawlExecutorOptions<T>
): Promise<void> {
  const pending = new Map(options.tasks.map((task) => [task.url, task]))
  const config = new Configuration({
    persistStorage: false,
    storageClientOptions: { persistStorage: false, writeMetadata: false },
    purgeOnStart: false,
    defaultRequestQueueId: randomUUID(),
    defaultKeyValueStoreId: randomUUID()
  })
  let controlError: unknown
  let checkpoint = Promise.resolve()
  const saveCheckpoint = (): Promise<void> => {
    const urls = [...pending.keys()]
    checkpoint = checkpoint.then(() => options.onCheckpoint?.(urls))
    return checkpoint
  }
  const finish = async (task: T): Promise<void> => {
    pending.delete(task.url)
    await saveCheckpoint()
  }
  const enqueue = async (task: T): Promise<void> => {
    pending.set(task.url, task)
    await crawler.addRequests([{ url: task.url, uniqueKey: task.url }])
  }
  const crawler = new BasicCrawler(
    {
      maxConcurrency: options.concurrency ?? CRAWL_EXECUTION_DEFAULTS.httpConcurrency,
      maxRequestRetries: options.maxRetries ?? CRAWL_EXECUTION_DEFAULTS.maxRetries,
      // 单页请求自行携带可取消的超时；避免框架超时后仍写入 SQLite 的悬挂回调。
      requestHandlerTimeoutSecs: 86_400,
      useSessionPool: false,
      log: new Log({ level: LogLevel.OFF }),
      autoscaledPoolOptions: { maybeRunIntervalSecs: 0.01 },
      errorHandler: (_context, error) => options.onRetry?.(error),
      async requestHandler({ request }) {
        const task = pending.get(request.uniqueKey)
        if (!task || controlError) return
        try {
          throwIfAborted(options.signal)
          await options.beforeRequest?.()
          throwIfAborted(options.signal)
        } catch (error) {
          controlError = error
          crawler.stop()
          return
        }
        await options.handle(task, enqueue)
        throwIfAborted(options.signal)
        try {
          await finish(task)
        } catch (error) {
          controlError = error
          crawler.stop()
        }
      },
      async failedRequestHandler({ request }, error) {
        const task = pending.get(request.uniqueKey)
        if (!task || options.signal?.aborted || controlError) return
        await options.onFailure(task, error)
        await finish(task)
      }
    },
    config
  )
  const abort = (): void => crawler.stop()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    throwIfAborted(options.signal)
    await saveCheckpoint()
    await crawler.run(options.tasks.map((task) => ({ url: task.url, uniqueKey: task.url })))
    await checkpoint
    throwIfAborted(options.signal)
    if (controlError) throw controlError
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await crawler.teardown()
  }
}
