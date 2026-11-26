import type { CrawlProgress, CrawlRunState } from '@loci/shared'
import type { CrawlHistoryDatabase, CrawlRunSnapshot } from './crawl-history-database.js'
import { CrawlCancelledError, readRuntimeLock, type LockRecord } from './runtime-lock.js'

type ExternalCrawlDatabase = Pick<
  CrawlHistoryDatabase,
  'getActiveCrawlRun' | 'getLatestCrawlRun' | 'getCrawlRun'
>
interface ObservedCrawlLock {
  dataDir: string
  record: LockRecord
}

/** 发现文件锁对应的持久任务并复用其进度，避免第二个进程重复抓取。 */
export async function waitForExternalCrawl(
  database: ExternalCrawlDatabase,
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void,
  signal?: AbortSignal,
  lock?: ObservedCrawlLock
): Promise<CrawlProgress> {
  const run = await waitForActiveRun(database, sourceId, signal, lock)
  let previous = ''
  while (true) {
    signal?.throwIfAborted()
    const current = database.getCrawlRun(run.id)
    if (!current) throw new Error('正在运行的抓取任务记录已丢失')
    const serialized = JSON.stringify(current.progress)
    if (serialized !== previous) {
      previous = serialized
      onProgress?.(current.progress)
    }
    if (current.status === 'completed') return current.progress
    if (current.status === 'failed') {
      if (current.cancelled) throw new CrawlCancelledError()
      throw new Error(current.error ?? '抓取失败')
    }
    if (lock && !sameOwner(sourceId, lock)) {
      // 持有者可能恰好在读取状态后完成提交并释放锁，复查终态后再报告中断。
      if (database.getCrawlRun(run.id)?.status !== 'running') continue
      throw new Error('原抓取进程已退出，请重新启动抓取')
    }
    await delay(100, signal)
  }
}

export function crawlRunState(snapshot: CrawlRunSnapshot): CrawlRunState {
  return {
    sourceId: snapshot.sourceId,
    progress: snapshot.progress,
    nodes: snapshot.progress.node ? [snapshot.progress.node] : [],
    error: snapshot.error,
    running: snapshot.status === 'running',
    paused: false
  }
}

export async function waitForCrawlLockRelease(
  dataDir: string,
  sourceId: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    signal?.throwIfAborted()
    if (!readRuntimeLock(dataDir, `crawl-${sourceId}`)) return
    await delay(20, signal)
  }
  throw new Error('等待文档源锁释放超时')
}

async function waitForActiveRun(
  database: ExternalCrawlDatabase,
  sourceId: string,
  signal?: AbortSignal,
  lock?: ObservedCrawlLock
): Promise<CrawlRunSnapshot> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    signal?.throwIfAborted()
    if (lock?.record.crawlRunId) {
      const run = database.getCrawlRun(lock.record.crawlRunId)
      if (run) return run
    } else {
      const run = lock ? database.getLatestCrawlRun(sourceId) : database.getActiveCrawlRun(sourceId)
      if (run && (!lock || (run.startedAt && run.startedAt >= lock.record.startedAt))) return run
    }
    if (lock && !sameOwner(sourceId, lock)) break
    await delay(20, signal)
  }
  throw new Error('文档源已被其他进程占用，但没有找到可复用的任务记录')
}

function sameOwner(sourceId: string, lock: ObservedCrawlLock): boolean {
  const owner = readRuntimeLock(lock.dataDir, `crawl-${sourceId}`)
  return (
    owner?.pid === lock.record.pid &&
    owner.startedAt === lock.record.startedAt &&
    owner.crawlRunId === lock.record.crawlRunId
  )
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }
    const timeout = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
