import type { CrawlProgress, CrawlRunState } from '@loci/shared'
import type { CrawlHistoryDatabase, CrawlRunSnapshot } from './crawl-history-database.js'

type ExternalCrawlDatabase = Pick<CrawlHistoryDatabase, 'getActiveCrawlRun' | 'getCrawlRun'>

/** 发现文件锁对应的持久任务并复用其进度，避免第二个进程重复抓取。 */
export async function waitForExternalCrawl(
  database: ExternalCrawlDatabase,
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void
): Promise<CrawlProgress> {
  const run = await waitForActiveRun(database, sourceId)
  let previous = ''
  while (true) {
    const current = database.getCrawlRun(run.id)
    if (!current) throw new Error('正在运行的抓取任务记录已丢失')
    const serialized = JSON.stringify(current.progress)
    if (serialized !== previous) {
      previous = serialized
      onProgress?.(current.progress)
    }
    if (current.status === 'completed') return current.progress
    if (current.status === 'failed') throw new Error(current.error ?? '抓取失败')
    await delay(100)
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

async function waitForActiveRun(
  database: ExternalCrawlDatabase,
  sourceId: string
): Promise<CrawlRunSnapshot> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = database.getActiveCrawlRun(sourceId)
    if (run) return run
    await delay(20)
  }
  throw new Error('文档源已被其他进程占用，但没有找到可复用的任务记录')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
