import { crawlSource } from '@loci/core'
import type { CrawlProgress } from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'
import { fetchRenderedCrawlPage } from './rendered'

/** 桌面端只连接数据库与 Electron 浏览器，抓取流程统一由核心包编排。 */
export async function runSourceCrawl(
  database: LociDatabase,
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void,
  waitIfPaused?: () => Promise<void>,
  sleep?: (milliseconds: number) => Promise<void>
): Promise<CrawlProgress> {
  const source = database.getSourceConfig(sourceId)
  const settings = database.getSettings()
  const result = await crawlSource({
    firstUrl: source.firstUrl,
    firstNodeId: source.firstUrl,
    hostname: source.hostname,
    scopePath: source.scopePath,
    pageLimit: source.pageLimit,
    initialUrls: database.listDocumentUrls(sourceId),
    fetchMode: source.fetchMode,
    httpConcurrency: source.httpConcurrency ?? settings.httpConcurrency,
    browserConcurrency: source.browserConcurrency ?? settings.browserConcurrency,
    maxRetries: settings.maxRetries,
    batchIntervalMs: settings.batchIntervalSeconds * 1000,
    waitIfPaused,
    sleep,
    crawler: { fetchPage: fetchRenderedCrawlPage },
    onDocument: (document) => database.saveDocument({ ...document, sourceId }),
    onError: ({ url, missing }) => {
      if (missing) database.deleteDocument(sourceId, url)
    },
    onProgress,
    onResolved: (resolution) =>
      database.updateResolvedSource(
        sourceId,
        resolution.firstUrl,
        resolution.fetchMode,
        resolution.iconUrl
      )
  })
  return result.progress
}
