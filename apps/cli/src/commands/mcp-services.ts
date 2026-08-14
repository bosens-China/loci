import type { LociMcpServices } from '@loci/runtime'
import type { createCliRuntime } from '../runtime.js'

export function createMcpServices(runtime: ReturnType<typeof createCliRuntime>): LociMcpServices {
  return {
    listSources: () => runtime.database.listSources(),
    listDocuments: () => runtime.database.listDocuments(),
    searchDocuments: (query, mode) => runtime.database.searchDocuments(query, mode),
    createSource: runtime.createSource,
    crawlSource: runtime.crawlSource,
    deleteSource: runtime.deleteSource,
    isCrawling: runtime.isCrawling,
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
