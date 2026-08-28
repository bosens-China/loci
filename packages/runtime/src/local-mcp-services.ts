import type { CrawlProgress } from '@loci/shared'
import { inspectSource } from '@loci/core'
import type { LociMcpServices } from './mcp/server.js'
import type { LocalRuntime } from './local-runtime.js'
import { runDurableSourceSync } from './local-source-sync.js'

export interface LocalMcpServicesOptions {
  durableJobs?: boolean
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
      ? (sourceId, onProgress, signal) => runDurableSync(runtime, sourceId, onProgress, signal)
      : (sourceId, onProgress, signal) =>
          runtime.crawlSource(sourceId, onProgress, undefined, signal),
    fetchPages: (sourceId, urls, onProgress, signal) =>
      runtime.fetchPages(sourceId, urls, undefined, signal, onProgress),
    startUrlReview: (sourceId, goal, signal) =>
      runtime.urlReviews.start(sourceId, goal, undefined, signal),
    submitUrlReview: (runId, batchId, excludeUrls, signal) =>
      runtime.urlReviews.submit(runId, batchId, excludeUrls, undefined, signal),
    getUrlReview: runtime.urlReviews.get,
    getActiveUrlReview: runtime.urlReviews.getActive,
    cancelUrlReview: runtime.urlReviews.cancel,
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
    listLocalJobs: (limit) => runtime.database.listLocalJobs(limit),
    getLocalJob: (id) => runtime.database.getLocalJob(id),
    pauseLocalJob: (id) => runtime.database.requestLocalJobPause(id),
    resumeLocalJob: (id) => runtime.database.resumeLocalJob(id),
    stopLocalJob: (id) => runtime.database.requestLocalJobStop(id),
    cancelLocalJob: (id) => runtime.database.requestLocalJobCancellation(id),
    setLocalJobPriority: (id, priority) => runtime.database.setLocalJobPriority(id, priority),
    pauseLocalJobs: (hostname) => runtime.database.pauseLocalJobs(hostname),
    resumeLocalJobs: (hostname) => runtime.database.resumeLocalJobs(hostname),
    listOperationLogs: (filters) => runtime.database.listOperationLogs(filters),
    listHostnameCrawlPolicies: () => runtime.database.listHostnameCrawlPolicies(),
    saveHostnameCrawlPolicy: (input) => runtime.database.saveHostnameCrawlPolicy(input),
    deleteHostnameCrawlPolicy: (hostname) => runtime.database.deleteHostnameCrawlPolicy(hostname),
    listServerHostnamePolicies: () =>
      withMcpAdmin(runtime, () => runtime.admin.listHostnamePolicies()),
    saveServerHostnamePolicy: (input) =>
      withMcpAdmin(runtime, () => runtime.admin.saveHostnamePolicy(input)),
    deleteServerHostnamePolicy: (hostname) =>
      withMcpAdmin(runtime, () => runtime.admin.deleteHostnamePolicy(hostname)),
    getServerCrawlSettings: () => withMcpAdmin(runtime, () => runtime.admin.getCrawlSettings()),
    saveServerCrawlSettings: (input) =>
      withMcpAdmin(runtime, () => runtime.admin.saveCrawlSettings(input)),
    listCloudLibraries: () => runtime.cloud.listCatalog(runtime.database.getSettings().serverUrl),
    getCloudLibraryTree: async (libraryId, parent, depth) =>
      (
        await runtime.cloud.getLibraryTree(
          runtime.database.getSettings().serverUrl,
          libraryId,
          parent,
          depth
        )
      ).nodes,
    readCloudLibraryFile: (libraryId, fileId, offset, maxChars) =>
      runtime.cloud.readLibraryFile(
        runtime.database.getSettings().serverUrl,
        libraryId,
        fileId,
        offset,
        maxChars
      ),
    pullCloudLibrary: (libraryId) => {
      runtime.assertWritable()
      return runtime.cloud.importLibrary(runtime.database.getSettings().serverUrl, libraryId, false)
    },
    publishLocalLibrary: async (sourceId, mode, targetLibraryId) => {
      const archive = await runtime.database.exportLibraryPublishArchive(
        sourceId,
        mode,
        targetLibraryId
      )
      return withMcpAdmin(runtime, () => runtime.admin.publishLibrary(archive))
    },
    moveDocumentsToNewSource: (input) => runtime.database.moveDocumentsToNewSource(input),
    listServerTasks: () => withMcpAdmin(runtime, () => runtime.admin.listSyncJobs()),
    controlServerTask: (id, action) =>
      withMcpAdmin(runtime, () => runtime.admin.controlSyncJob(id, action)),
    setServerTaskPriority: (id, priority) =>
      withMcpAdmin(runtime, () => runtime.admin.setSyncJobPriority(id, priority)),
    controlServerTasks: (action, hostname) =>
      withMcpAdmin(runtime, () => runtime.admin.controlSyncJobs(action, hostname)),
    listServerLibraries: () => withMcpAdmin(runtime, () => runtime.admin.listLibraries()),
    createServerLibrary: (input) => withMcpAdmin(runtime, () => runtime.admin.createLibrary(input)),
    updateServerLibrary: (id, input) =>
      withMcpAdmin(runtime, () => runtime.admin.updateLibrary(id, input)),
    deleteServerLibrary: (id) => withMcpAdmin(runtime, () => runtime.admin.deleteLibrary(id)),
    syncServerLibraries: (ids) => withMcpAdmin(runtime, () => runtime.admin.syncLibraries(ids))
  }
}

const runDurableSync = (
  runtime: LocalRuntime,
  sourceId: string,
  onProgress?: Parameters<LociMcpServices['crawlSource']>[1],
  signal?: AbortSignal
): Promise<CrawlProgress> => runDurableSourceSync(runtime, sourceId, 'mcp', onProgress, signal)

async function withMcpAdmin<T>(runtime: LocalRuntime, action: () => Promise<T>): Promise<T> {
  if (!runtime.admin.getSession()) {
    const username = process.env.LOCI_ADMIN_USERNAME?.trim()
    const password = process.env.LOCI_ADMIN_PASSWORD
    if (!username || !password) {
      throw new Error('Server 管理工具需要设置 LOCI_ADMIN_USERNAME 和 LOCI_ADMIN_PASSWORD')
    }
    await runtime.admin.login(runtime.database.getSettings().serverUrl, { username, password })
  }
  return action()
}
