import type { CrawlProgress, ForegroundCrawlState } from '@loci/shared'
import { crawlRequestKey } from './crawl-task-coordinator.js'
import { CrawlCancelledError, RuntimeLockedError } from './runtime-lock.js'
import type { LocalRuntime } from './local-runtime.js'
import { safeClientError } from './local-http-response.js'

/** 每个库只保留最近一次前台请求，服务关闭时等待所有取消信号生效。 */
export function createForegroundCrawls(runtime: LocalRuntime) {
  const tasks = new Map<
    string,
    { state: ForegroundCrawlState; key: string; controller: AbortController; done: Promise<void> }
  >()
  return {
    start(libraryId: string, urls?: string[]) {
      runtime.database.getSourceConfig(libraryId)
      const key = crawlRequestKey(urls ? 'pages' : 'sync', urls)
      const current = tasks.get(libraryId)
      if (current?.state.status === 'running') {
        if (current.key !== key) throw new RuntimeLockedError('文档库已有其他抓取正在运行', null)
        return current.state
      }
      const controller = new AbortController()
      const state: ForegroundCrawlState = {
        libraryId,
        kind: urls ? 'pages' : 'sync',
        status: 'running',
        progress: null,
        error: null
      }
      const report = (progress: CrawlProgress) => {
        state.progress = progress
      }
      const run = async () => {
        try {
          if (urls) {
            const result = await runtime.fetchPages(
              libraryId,
              urls,
              undefined,
              controller.signal,
              report
            )
            state.items = result.items
            state.progress = result.progress
          } else
            state.progress = await runtime.crawlSource(
              libraryId,
              report,
              undefined,
              controller.signal
            )
          if (state.progress.failed > 0) {
            state.status = state.progress.succeeded > 0 ? 'completed_with_errors' : 'failed'
            state.error =
              state.progress.failures?.[0]?.message ??
              state.items?.find((item) => item.message)?.message ??
              `${state.progress.failed} 个页面抓取失败`
          } else state.status = 'completed'
        } catch (error) {
          state.status =
            controller.signal.aborted || error instanceof CrawlCancelledError
              ? 'cancelled'
              : 'failed'
          state.error = safeClientError(error)
        }
      }
      tasks.set(libraryId, { state, key, controller, done: run() })
      return state
    },
    get: (id: string) => tasks.get(id)?.state ?? null,
    cancel(id: string) {
      const task = tasks.get(id)
      if (task?.state.status === 'running') task.controller.abort(new Error('抓取已取消'))
      return task?.state ?? null
    },
    clear() {
      tasks.clear()
    },
    async close() {
      for (const task of tasks.values()) task.controller.abort()
      await Promise.all([...tasks.values()].map((task) => task.done))
    }
  }
}
