import type { CrawlProgress } from '@loci/shared'
import { inspectSource } from '@loci/core'
import type { LociMcpServices } from './mcp/server.js'
import type { LocalRuntime } from './local-runtime.js'
import { runDurableSourceSync } from './local-source-sync.js'

export interface LocalMcpServicesOptions {
  durableJobs?: boolean
  signal?: AbortSignal
}

/** transport 只决定如何连接；启用 durableJobs 后统一提交持久队列。 */
export function createLocalMcpServices(
  runtime: LocalRuntime,
  options: LocalMcpServicesOptions = {}
): LociMcpServices {
  return {
    listSources: () => runtime.database.listSources(),
    listDocuments: () => runtime.database.listDocuments(),
    searchDocuments: (query, mode) => runtime.database.searchDocuments(query, mode),
    createSource: runtime.createSource,
    inspectSource,
    updateSource: runtime.updateSourcePreservingSchedule,
    crawlSource: options.durableJobs
      ? (sourceId, onProgress) => runDurableSync(runtime, sourceId, onProgress, options.signal)
      : runtime.crawlSource,
    fetchPages: (sourceId, urls) => runtime.fetchPages(sourceId, urls, undefined, options.signal),
    deleteSource: runtime.deleteSource,
    isCrawling: options.durableJobs
      ? (sourceId) =>
          runtime.isCrawling(sourceId) ||
          runtime.database
            .listLocalJobs(500)
            .some(
              (job) =>
                job.sourceId === sourceId && (job.status === 'pending' || job.status === 'running')
            )
      : runtime.isCrawling,
    getCrawlState: runtime.getCrawlState,
    getLatestCrawlRunId: (libraryId) => runtime.database.listCrawlHistory(libraryId)[0]?.id,
    getCrawlRunLibraryId: (runId) => runtime.database.getCrawlRun(runId)?.sourceId,
    listCrawlFailures: (runId) => runtime.database.listCrawlFailures(runId),
    listCloudLibraries: () => runtime.cloud.listCatalog(runtime.database.getSettings().serverUrl),
    pullCloudLibrary: (libraryId) => {
      runtime.assertWritable()
      return runtime.cloud.importLibrary(runtime.database.getSettings().serverUrl, libraryId, false)
    }
  }
}

const runDurableSync = (
  runtime: LocalRuntime,
  sourceId: string,
  onProgress?: Parameters<LociMcpServices['crawlSource']>[1],
  signal?: AbortSignal
): Promise<CrawlProgress> => runDurableSourceSync(runtime, sourceId, 'mcp', onProgress, signal)
