import { crawlSource, GithubLimitError, parseGithubRepositoryUrl } from '@loci/core'
import type { CrawledDocument } from '@loci/core'
import { randomIntervalSeconds } from '@loci/shared'
import { createBrowserCrawler } from './browser-crawl.js'
import type { BrowserConfig } from './browser-config.js'
import { ServerDatabase } from './database.js'
import type { SyncJob } from './types.js'

class SyncControlError extends Error {
  constructor(readonly action: 'pause' | 'stop') {
    super(action === 'pause' ? '同步已暂停' : '同步已结束')
  }
}

interface RunSyncJobOptions {
  database: ServerDatabase
  fetchImpl: typeof fetch
  browserConfig?: BrowserConfig
  ownerId: string
  job: SyncJob
  signal: AbortSignal
  onLeaseLost: () => void
}

/** 单次 Server 抓取执行；所有终态都通过持久状态机提交。 */
export async function runServerSyncJob(options: RunSyncJobOptions): Promise<void> {
  const { database, ownerId, job, signal } = options
  const library = database.getLibrary(job.libraryId)
  const documents: CrawledDocument[] = []
  const deletedUrls: string[] = []
  let replaceAll = false
  let contentBytes = job.contentBytes
  let fetchMode: 'http' | 'browser' = 'http'
  try {
    assertNotCanceled(signal)
    let pendingUrls = database.syncJobs.getResumeUrls(job.id)
    const result = await crawlSource({
      kind: parseGithubRepositoryUrl(library.url) ? 'github' : 'web',
      firstUrl: library.url,
      hostname: library.hostname,
      scopePath: library.scopePath,
      pageLimit: library.pageLimit,
      initialUrls: pendingUrls.length ? pendingUrls : database.listDocumentUrls(library.id),
      fetchMode: 'auto',
      httpConcurrency: 9,
      browserConcurrency: 5,
      getBatchPolicy: () => {
        const policy = database.hostnamePolicies.get(library.hostname)
        const minimum = policy?.batchIntervalMinSeconds ?? 0
        const maximum = policy?.batchIntervalMaxSeconds ?? minimum
        return {
          concurrency:
            fetchMode === 'browser'
              ? (policy?.browserConcurrency ?? 5)
              : (policy?.httpConcurrency ?? 9),
          batchIntervalMs: randomIntervalSeconds(minimum, maximum) * 1000
        }
      },
      onResolved: (resolution) => {
        fetchMode = resolution.fetchMode
      },
      githubPreviousRevision: library.githubRevision,
      githubBlocked: library.githubBlocked,
      signal,
      waitIfPaused: async () => assertCanContinue(database, job.id, signal),
      onCheckpoint: ({ pendingUrls: remaining }) => {
        pendingUrls = remaining
        if (!job.progress) return
        database.syncJobs.checkpoint(job.id, ownerId, job.progress, pendingUrls, contentBytes)
      },
      crawler: options.browserConfig ? createBrowserCrawler(options.browserConfig) : undefined,
      fetch: options.fetchImpl,
      onDocument: (document) => {
        documents.push(document)
        contentBytes += Buffer.byteLength(document.markdown, 'utf8')
      },
      onSnapshot: (snapshot) => {
        replaceAll = true
        contentBytes = 0
        documents.push(...snapshot)
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
      onProgress: (progress) => {
        job.progress = progress
        if (!database.syncJobs.heartbeat(job.id, ownerId, leaseExpiresAt(), progress)) {
          options.onLeaseLost()
        }
      }
    })
    assertNotCanceled(signal)
    const progress = result.progress
    if (progress.succeeded === 0 && progress.failed > 0) {
      throw new Error(`同步失败：${progress.failed} 个页面均未成功`)
    }
    database.syncJobs.checkpoint(job.id, ownerId, progress, [], contentBytes)
    database.commitCrawl(library.id, {
      jobId: job.id,
      ownerId,
      documents,
      deletedUrls,
      replaceAll,
      githubRevision: result.resolution.github?.revision
    })
    job.progress = progress
    job.failures = progress.failures ?? []
    job.status = progress.failed > 0 ? 'completed_with_errors' : 'completed'
    assignJob(
      job,
      database.syncJobs.finish(job.id, ownerId, job.status, job.progress, job.failures, null)
    )
  } catch (error) {
    if (error instanceof SyncControlError) {
      commitControlledResult(
        options,
        documents,
        deletedUrls,
        replaceAll,
        contentBytes,
        error.action
      )
      return
    }
    if (signal.aborted) {
      job.status = 'canceled'
    } else {
      if (error instanceof GithubLimitError) {
        database.updateGithubBlocked(job.libraryId, {
          revision: error.revision,
          kind: error.kind,
          limitBytes: error.limitBytes
        })
      }
      const message = error instanceof Error ? error.message : '同步失败'
      database.finishCrawl(job.libraryId, message)
      job.error = message
      job.status = 'failed'
    }
    assignJob(
      job,
      database.syncJobs.finish(
        job.id,
        ownerId,
        job.status === 'canceled' ? 'canceled' : 'failed',
        job.progress,
        job.failures,
        job.error
      )
    )
  }
}

function commitControlledResult(
  options: RunSyncJobOptions,
  documents: CrawledDocument[],
  deletedUrls: string[],
  replaceAll: boolean,
  contentBytes: number,
  action: 'pause' | 'stop'
): void {
  const { database, ownerId, job } = options
  if (documents.length) {
    database.commitCrawl(job.libraryId, {
      jobId: job.id,
      ownerId,
      documents,
      deletedUrls,
      replaceAll
    })
  }
  assignJob(
    job,
    action === 'pause'
      ? database.syncJobs.releasePaused(job.id, ownerId)
      : database.syncJobs.finishPartial(job.id, ownerId, job.progress, contentBytes)
  )
}

function assertCanContinue(database: ServerDatabase, id: string, signal: AbortSignal): void {
  assertNotCanceled(signal)
  const job = database.syncJobs.get(id)
  if (!job || job.status === 'canceling' || job.status === 'canceled') {
    throw signal.reason ?? new Error('同步已取消')
  }
  if (job.stopRequested) throw new SyncControlError('stop')
  if (job.pauseRequested) throw new SyncControlError('pause')
}

function assertNotCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('同步已取消')
}

function leaseExpiresAt(): string {
  return new Date(Date.now() + 30_000).toISOString()
}

function assignJob(target: SyncJob, source: SyncJob): void {
  Object.assign(target, source)
}
