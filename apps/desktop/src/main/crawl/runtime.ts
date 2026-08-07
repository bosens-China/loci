import {
  CrawlTaskCoordinator,
  RuntimeLockedError,
  acquireCrawlRuntimeLock,
  crawlRunState,
  readRuntimeLock,
  waitForExternalCrawl,
  type LociDatabase
} from '@loci/runtime'
import type { CrawlNode, CrawlProgress, CrawlRunState } from '@loci/shared'
import { CrawlControl } from './control'
import { runSourceCrawl } from './source'

interface DesktopCrawlRuntimeOptions {
  getDatabase: () => LociDatabase
  getDataDir: () => string
  publishState: (state: CrawlRunState) => void
}

export interface DesktopCrawlRuntime {
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<CrawlProgress>
  setPaused: (sourceId: string, paused: boolean) => void
  cancelPaused: (sourceId: string) => Promise<void>
  isCrawling: (sourceId: string) => boolean
  getState: (sourceId: string) => CrawlRunState | undefined
  listStates: () => CrawlRunState[]
  clearStates: () => void
  deleteState: (sourceId: string) => void
}

// 桌面端专属的暂停、窗口状态和进程锁统一由单个运行时维护。
export function createDesktopCrawlRuntime(
  options: DesktopCrawlRuntimeOptions
): DesktopCrawlRuntime {
  const tasks = new CrawlTaskCoordinator()
  const running = new Set<string>()
  const states = new Map<string, CrawlRunState>()
  const controls = new Map<string, CrawlControl>()

  const publish = (state: CrawlRunState): void => {
    states.set(state.sourceId, state)
    options.publishState(state)
  }

  const setPaused = (sourceId: string, paused: boolean, required = true): void => {
    const control = controls.get(sourceId)
    if (!control) {
      if (required) throw new Error('这个文档源当前没有正在运行的抓取任务')
      return
    }
    if (paused) control.pause()
    else control.resume()
    const current = states.get(sourceId)
    if (current) publish({ ...current, paused })
  }

  const waitIfPaused = async (sourceId: string): Promise<void> => {
    const control = controls.get(sourceId)
    if (!control) throw new Error('抓取任务不存在')
    await control.waitIfPaused()
  }

  const waitForDelay = async (sourceId: string, milliseconds: number): Promise<void> => {
    const control = controls.get(sourceId)
    if (!control) throw new Error('抓取任务不存在')
    await control.waitForDelay(milliseconds)
  }

  const emitProgress = (sourceId: string, progress: CrawlProgress): void => {
    const current = states.get(sourceId)
    if (!current) return
    publish({ ...current, progress, nodes: mergeNode(current.nodes, progress.node) })
  }

  const finish = (
    sourceId: string,
    progress: CrawlProgress | undefined,
    error: string | null
  ): void => {
    const current = states.get(sourceId)
    if (!current) return
    publish({
      ...current,
      progress: progress ? { ...progress, node: current.progress.node } : current.progress,
      error,
      running: false,
      paused: false
    })
  }

  const runOnce = async (
    id: string,
    onProgress: (progress: CrawlProgress) => void
  ): Promise<CrawlProgress> => {
    let lock
    try {
      lock = acquireCrawlRuntimeLock(options.getDataDir(), id, '桌面端')
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) throw error
      if (!readRuntimeLock(options.getDataDir(), `crawl-${id}`)) throw error
      const database = options.getDatabase()
      const progress = await waitForExternalCrawl(database, id, (current) => {
        publish({
          sourceId: id,
          progress: current,
          nodes: current.node ? [current.node] : [],
          error: null,
          running: true,
          paused: false
        })
        onProgress(current)
      })
      publish({
        sourceId: id,
        progress,
        nodes: progress.node ? [progress.node] : [],
        error: null,
        running: false,
        paused: false
      })
      return progress
    }
    try {
      const database = options.getDatabase()
      const source = database.getSourceConfig(id)
      const initialNode: CrawlNode = {
        id: source.firstUrl,
        url: source.firstUrl,
        title: source.fetchMode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
        status: 'running'
      }
      controls.set(id, new CrawlControl())
      publish({
        sourceId: id,
        progress: {
          queued: 1,
          processed: 0,
          succeeded: 0,
          failed: 0,
          limitReached: false,
          node: initialNode
        },
        nodes: [initialNode],
        error: null,
        running: true,
        paused: false
      })
      running.add(id)
      try {
        const runId = database.startCrawlRun(id)
        try {
          const progress = await runSourceCrawl(
            database,
            id,
            (current) => {
              emitProgress(id, current)
              database.updateCrawlRunProgress(runId, current)
              onProgress(current)
            },
            () => waitIfPaused(id),
            (milliseconds) => waitForDelay(id, milliseconds),
            controls.get(id)?.signal
          )
          if (progress.succeeded === 0 && progress.failed > 0) {
            throw new Error(`抓取失败：${progress.failed} 个页面均未成功`)
          }
          finish(id, progress, null)
          database.finishCrawlRun(runId, 'completed', progress, null)
          return progress
        } catch (error) {
          const message = errorMessage(error)
          const progress = states.get(id)?.progress
          finish(id, progress, message)
          database.finishCrawlRun(runId, 'failed', progress, message)
          throw error
        }
      } finally {
        const control = controls.get(id)
        setPaused(id, false, false)
        controls.delete(id)
        running.delete(id)
        control?.finish()
      }
    } finally {
      lock.release()
    }
  }

  const isCrawling = (sourceId: string): boolean =>
    tasks.isRunning(sourceId) ||
    running.has(sourceId) ||
    Boolean(readRuntimeLock(options.getDataDir(), `crawl-${sourceId}`))

  return {
    crawlSource: (id, onProgress) => tasks.run(id, (report) => runOnce(id, report), onProgress),
    setPaused: (sourceId, paused) => setPaused(sourceId, paused),
    cancelPaused: async (sourceId) => {
      if (!isCrawling(sourceId)) return
      const control = controls.get(sourceId)
      if (!control?.paused) throw new Error('更新进行中，请先暂停再删除文档源')
      control.cancel()
      setPaused(sourceId, false, false)
      await control.done
    },
    isCrawling,
    getState: (sourceId) => {
      const local = states.get(sourceId)
      if (local) return local
      const active = options.getDatabase().getActiveCrawlRun(sourceId)
      return active ? crawlRunState(active) : undefined
    },
    listStates: () => [...states.values()],
    clearStates: () => states.clear(),
    deleteState: (sourceId) => states.delete(sourceId)
  }
}

function mergeNode(nodes: CrawlNode[], node: CrawlNode | undefined): CrawlNode[] {
  if (!node) return nodes
  const index = nodes.findIndex((item) => item.id === node.id)
  return index < 0
    ? [...nodes, node]
    : nodes.map((item, itemIndex) => (itemIndex === index ? node : item))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '更新失败'
}
