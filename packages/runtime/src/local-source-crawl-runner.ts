import {
  crawlSource,
  GithubLimitError,
  type CrawlNode,
  type CrawlProgress,
  type SourceResolution
} from '@loci/core'
import type { CrawlRunState } from '@loci/shared'
import { LocalBrowserCrawler, type BrowserInstallPrompt } from './browser-crawler.js'
import { resolveCrawlBatchPolicy } from './crawl-batch-policy.js'
import type { LociDatabase } from './database.js'
import { assertLocalJobCanContinue, LocalJobControlError } from './local-job-control.js'
import { waitForCrawlLockRelease, waitForExternalCrawl } from './external-crawl.js'
import {
  fetchSourceExplicitPages,
  mergeCrawlProgress,
  mergeExplicitPageProgress
} from './explicit-page-service.js'
import { refreshReviewedSource } from './reviewed-source-refresh.js'
import { RuntimeLockedError, acquireCrawlRuntimeLock, readRuntimeLock } from './runtime-lock.js'

interface CrawlRunnerContext {
  dataDir: string
  owner: string
  database: LociDatabase
  browser: LocalBrowserCrawler
  states: Map<string, CrawlRunState>
}

export type RunLocalSourceCrawl = (
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  localJob?: { id: string; owner: string }
) => Promise<CrawlProgress>

/** 单次文档库抓取与原子提交，入口运行时只负责调度和资源生命周期。 */
export function createLocalSourceCrawlRunner(context: CrawlRunnerContext): RunLocalSourceCrawl {
  const { dataDir, owner, database, browser, states } = context
  const run: RunLocalSourceCrawl = async (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    localJob?: { id: string; owner: string }
  ): Promise<CrawlProgress> => {
    let lock
    try {
      lock = acquireCrawlRuntimeLock(dataDir, sourceId, owner)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) throw error
      if (!readRuntimeLock(dataDir, `crawl-${sourceId}`)) throw error
      const pageFetchIsRunning = error.record?.owner.includes('指定页面抓取') === true
      try {
        const progress = await waitForExternalCrawl(
          database,
          sourceId,
          (current) => {
            updateState(states, sourceId, current, null, true)
            onProgress?.(current)
          },
          signal
        )
        if (!pageFetchIsRunning) return progress
      } catch (waitError) {
        if (!pageFetchIsRunning || signal?.aborted) throw waitError
      }
      await waitForCrawlLockRelease(dataDir, sourceId, signal)
      return run(sourceId, onProgress, onBrowserMissing, signal, localJob)
    }
    try {
      const source = database.getSourceConfig(sourceId)
      const activeReview = database.getActiveUrlReview(sourceId)
      if (activeReview) throw new Error('文档库正在等待 Agent URL 审查，完成或取消后才能普通同步')
      const initialNode: CrawlNode = {
        id: source.firstUrl,
        url: source.firstUrl,
        title: source.fetchMode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
        status: 'running'
      }
      states.set(sourceId, {
        sourceId,
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
      const runId = database.startCrawlRun(sourceId)
      const documents: Parameters<LociDatabase['saveDocument']>[0][] = []
      const deletedUrls: string[] = []
      let replaceAll = false
      let contentBytes = 0
      let pendingUrls = localJob ? database.getLocalJobResumeUrls(localJob.id) : []
      let resolution: SourceResolution | undefined
      try {
        const reportProgress = (progress: CrawlProgress): void => {
          updateState(states, sourceId, progress, null, true)
          database.updateCrawlRunProgress(runId, progress)
          onProgress?.(progress)
        }
        const reviewed =
          source.discoveryMode === 'agent_review'
            ? await refreshReviewedSource(
                database,
                browser,
                source,
                onBrowserMissing,
                signal,
                reportProgress
              )
            : undefined
        if (reviewed) {
          if (reviewed.progress.processed === 0) reportProgress(reviewed.progress)
        }
        const result = reviewed
          ? {
              progress: reviewed.progress,
              resolution: {
                firstUrl: reviewed.resolution.firstUrl,
                hostname: source.hostname,
                fetchMode: reviewed.resolution.fetchMode,
                iconUrl: reviewed.resolution.iconUrl,
                discovery: 'pages' as const
              }
            }
          : await crawlSource({
              kind: source.kind,
              firstUrl: source.firstUrl,
              firstNodeId: source.firstUrl,
              hostname: source.hostname,
              scopePath: source.scopePath,
              excludePathPattern: source.excludePathPattern,
              pageLimit: source.pageLimit,
              initialUrls: pendingUrls.length ? pendingUrls : database.listDocumentUrls(sourceId),
              fetchMode: source.fetchMode,
              httpConcurrency: resolveCrawlBatchPolicy(database, source, 'http').concurrency,
              browserConcurrency: resolveCrawlBatchPolicy(database, source, 'browser').concurrency,
              maxRetries: database.getSettings().maxRetries,
              batchIntervalMs: resolveCrawlBatchPolicy(database, source, source.fetchMode)
                .batchIntervalMs,
              githubArchiveLimitBytes:
                (source.githubArchiveLimitMb ?? database.getSettings().githubArchiveLimitMb) *
                1024 *
                1024,
              githubMarkdownLimitBytes:
                (source.githubMarkdownLimitMb ?? database.getSettings().githubMarkdownLimitMb) *
                1024 *
                1024,
              githubPreviousRevision: source.githubRevision,
              githubBlocked: source.githubBlocked,
              signal,
              waitIfPaused: async () => {
                if (localJob) assertLocalJobCanContinue(database, localJob.id)
              },
              getBatchPolicy: () => {
                const fetchMode = resolution?.fetchMode ?? source.fetchMode
                return resolveCrawlBatchPolicy(database, source, fetchMode)
              },
              onCheckpoint: ({ pendingUrls: remaining }) => {
                pendingUrls = remaining
                if (!localJob) return
                const progress = states.get(sourceId)?.progress
                if (progress) {
                  database.checkpointLocalJob(
                    localJob.id,
                    localJob.owner,
                    progress,
                    pendingUrls,
                    contentBytes
                  )
                }
              },
              onResolved: (resolved) => {
                resolution = resolved
              },
              crawler: { fetchPage: (url, request) => browser.fetchPage(url, request) },
              beforeBrowserCrawl: () => browser.ensureInstalled(onBrowserMissing),
              onDocument: (document) => {
                documents.push({ ...document, sourceId })
                contentBytes += Buffer.byteLength(document.markdown, 'utf8')
              },
              onSnapshot: (snapshot) => {
                replaceAll = true
                contentBytes = 0
                documents.push(...snapshot.map((document) => ({ ...document, sourceId })))
                for (const document of snapshot) {
                  contentBytes += Buffer.byteLength(document.markdown, 'utf8')
                }
              },
              onError: ({ url, missing }) => {
                if (missing) deletedUrls.push(url)
              },
              onDuplicate: ({ url }) => {
                deletedUrls.push(url)
              },
              onProgress: reportProgress
            })
        const targets = database.listExplicitPageTargets(sourceId)
        const targetUrls = new Set(targets.map((target) => target.url))
        const reviewedUrls = new Set(reviewed?.pages.map((page) => page.url) ?? [])
        const reviewedTargetPages = reviewed?.pages.filter((page) => targetUrls.has(page.url)) ?? []
        if (reviewed) {
          documents.push(...reviewed.documents.filter((document) => !targetUrls.has(document.url)))
          deletedUrls.push(...reviewed.deletedUrls.filter((url) => !targetUrls.has(url)))
        }
        const remainingTargets = reviewed
          ? targets.filter((target) => !reviewedUrls.has(target.url))
          : targets
        const explicit = remainingTargets.length
          ? await fetchSourceExplicitPages({
              database,
              browser,
              source,
              urls: remainingTargets.map((target) => target.url),
              fetchMode: result.resolution.fetchMode,
              signal,
              onBrowserMissing,
              onProgress: (progress) =>
                reportProgress(mergeCrawlProgress(result.progress, progress))
            })
          : undefined
        const progress = mergeExplicitPageProgress(result.progress, explicit?.items ?? [])
        const explicitPages = [...reviewedTargetPages, ...(explicit?.items ?? [])]
        if (!reviewed && progress.succeeded === 0 && progress.failed > 0) {
          throw new Error(`抓取失败：${progress.failed} 个页面均未成功`)
        }
        signal?.throwIfAborted()
        if (localJob) {
          database.checkpointLocalJob(localJob.id, localJob.owner, progress, [], contentBytes)
        }
        const committed = database.commitSourceCrawl(sourceId, {
          documents,
          deletedUrls,
          replaceAll,
          explicitPages: explicitPages.length ? explicitPages : undefined,
          ...(localJob ? { localJob: { ...localJob, runId, result: progress } } : {}),
          resolution: {
            firstUrl: result.resolution.firstUrl,
            mode: result.resolution.fetchMode,
            iconUrl: result.resolution.iconUrl,
            discovery: result.resolution.discovery,
            github: result.resolution.github
          }
        })
        if (!committed) throw new Error('任务已取消，未提交抓取结果')
        updateState(states, sourceId, progress, null, false)
        if (!localJob) database.finishCrawlRun(runId, 'completed', progress, null)
        return progress
      } catch (error) {
        if (error instanceof LocalJobControlError && localJob) {
          const progress = states.get(sourceId)?.progress ?? {
            queued: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            limitReached: false
          }
          if (error.action === 'pause') {
            const current = states.get(sourceId)
            if (current) {
              states.set(sourceId, { ...current, running: false, paused: true, error: null })
            }
            database.finishCrawlRun(runId, 'failed', progress, '任务已暂停')
            throw error
          }
          const resolved = resolution ?? partialResolution(source, documents)
          const committed = documents.length
            ? database.commitSourceCrawl(sourceId, {
                documents,
                deletedUrls,
                replaceAll,
                localJob: {
                  ...localJob,
                  runId,
                  result: progress,
                  partial: true,
                  contentBytes
                },
                resolution: {
                  firstUrl: resolved.firstUrl,
                  mode: resolved.fetchMode,
                  iconUrl: resolved.iconUrl,
                  discovery: resolved.discovery,
                  github: resolved.github
                }
              })
            : false
          if (!committed) {
            database.finishCrawlRun(runId, 'completed', progress, null)
            database.completePartialLocalJob(localJob.id, localJob.owner, progress, contentBytes)
          }
          const current = states.get(sourceId)
          if (current)
            states.set(sourceId, { ...current, running: false, paused: false, error: null })
          return progress
        }
        if (error instanceof GithubLimitError) {
          database.updateGithubBlocked(sourceId, {
            revision: error.revision,
            kind: error.kind,
            limitBytes: error.limitBytes
          })
        }
        const message = error instanceof Error ? error.message : '更新失败'
        const current = states.get(sourceId)
        if (current) states.set(sourceId, { ...current, running: false, error: message })
        database.finishCrawlRun(runId, 'failed', current?.progress, message)
        throw error
      }
    } finally {
      lock.release()
    }
  }

  return run
}

function partialResolution(
  source: ReturnType<LociDatabase['getSourceConfig']>,
  documents: Parameters<LociDatabase['saveDocument']>[0][]
): SourceResolution {
  return {
    firstUrl: source.firstUrl,
    hostname: source.hostname,
    fetchMode: source.fetchMode === 'auto' ? (documents[0]?.fetchMode ?? 'http') : source.fetchMode,
    iconUrl: null,
    discovery: source.kind === 'github' ? 'github' : 'pages',
    ...(source.kind === 'github' && source.githubDefaultBranch && source.githubRevision
      ? {
          github: {
            defaultBranch: source.githubDefaultBranch,
            revision: source.githubRevision
          }
        }
      : {})
  }
}

function updateState(
  states: Map<string, CrawlRunState>,
  sourceId: string,
  progress: CrawlProgress,
  error: string | null,
  running: boolean
): void {
  const current = states.get(sourceId)
  if (!current) return
  const node = progress.node
  const existingIndex = node ? current.nodes.findIndex((item) => item.id === node.id) : -1
  const nodes = !node
    ? current.nodes
    : existingIndex < 0
      ? [...current.nodes, node]
      : current.nodes.map((item, index) => (index === existingIndex ? node : item))
  states.set(sourceId, { ...current, progress, nodes, error, running, paused: false })
}
