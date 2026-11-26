import type { CrawlProgress } from '@loci/shared'
import type { BrowserInstallPrompt } from './browser-crawler.js'
import type { LocalRuntime } from './local-runtime.js'

export interface LocalSourceSyncOptions {
  onProgress?: (progress: CrawlProgress) => void
  onBrowserMissing?: BrowserInstallPrompt
  signal?: AbortSignal
}

/** 前台入口直接等待共享抓取任务，进度与取消信号传递到抓取器。 */
export function runLocalSourceSync(
  runtime: LocalRuntime,
  sourceId: string,
  options: LocalSourceSyncOptions = {}
): Promise<CrawlProgress> {
  return runtime.crawlSource(sourceId, options.onProgress, options.onBrowserMissing, options.signal)
}
