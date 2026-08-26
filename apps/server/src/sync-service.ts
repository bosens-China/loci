import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import PQueue from 'p-queue'
import {
  crawlSource,
  GithubLimitError,
  normalizeCronSchedule,
  parseGithubRepositoryUrl
} from '@loci/core'
import { createBrowserCrawler } from './browser-crawl.js'
import type { BrowserConfig } from './browser-config.js'
import { ServerDatabase } from './database.js'
import type { SyncJob } from './types.js'

class SyncCanceledError extends Error {}

/** 抓取、发布和定时调度统一走这里，保证同一文档库不会并发更新。 */
export class SyncService {
  readonly #ownerId = randomUUID()
  readonly #jobs = new Map<string, SyncJob>()
  readonly #tasks = new Map<string, Promise<void>>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #activeJobsByLibrary = new Map<string, SyncJob>()
  readonly #schedules = new Map<string, Cron>()
  readonly #queue: PQueue

  constructor(
    private readonly database: ServerDatabase,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly browserConfig?: BrowserConfig,
    maxConcurrentJobs = 3
  ) {
    this.#queue = new PQueue({ concurrency: maxConcurrentJobs })
  }

  restoreSchedules(): void {
    for (const library of this.database.listLibraries()) this.reschedule(library.id)
  }

  reschedule(libraryId: string): void {
    this.removeSchedule(libraryId)
    const library = this.database.getLibrary(libraryId)
    const schedule = normalizeCronSchedule(library.schedule)
    if (!schedule) return
    const job = new Cron(
      schedule,
      {
        protect: true,
        catch: (error) => console.error(`定时同步失败：${library.name}`, error)
      },
      () => {
        if (!this.isRunning(libraryId)) this.start(libraryId)
      }
    )
    this.#schedules.set(libraryId, job)
  }

  removeSchedule(libraryId: string): void {
    this.#schedules.get(libraryId)?.stop()
    this.#schedules.delete(libraryId)
  }

  start(libraryId: string): SyncJob {
    return this.startMany([libraryId])[0]!
  }

  startMany(libraryIds: readonly string[]): SyncJob[] {
    const ids = [...new Set(libraryIds)]
    for (const libraryId of ids) this.database.getLibrary(libraryId)
    return ids.map((libraryId) => {
      const local = this.#activeJobsByLibrary.get(libraryId)
      if (local) return local
      const acquired = this.database.syncJobs.getOrCreate(
        libraryId,
        this.#ownerId,
        leaseExpiresAt()
      )
      const job = publicJob(acquired.job)
      return acquired.created ? this.#enqueue(job) : job
    })
  }

  listJobs(): SyncJob[] {
    return this.database.syncJobs.list().map(publicJob)
  }

  cancel(id: string): SyncJob | undefined {
    const persisted = this.database.syncJobs.cancel(id)
    if (!persisted) return undefined
    const local = this.#jobs.get(id)
    if (local) assignJob(local, persisted)
    this.#controllers.get(id)?.abort(new SyncCanceledError('同步已取消'))
    return local ?? persisted
  }

  #enqueue(job: SyncJob): SyncJob {
    this.#jobs.set(job.id, job)
    this.#activeJobsByLibrary.set(job.libraryId, job)
    const controller = new AbortController()
    this.#controllers.set(job.id, controller)
    const heartbeat = setInterval(() => {
      const alive = this.database.syncJobs.heartbeat(
        job.id,
        this.#ownerId,
        leaseExpiresAt(),
        job.progress
      )
      if (!alive) controller.abort(new SyncCanceledError('同步已取消'))
    }, 1_000)
    heartbeat.unref()
    let execution: Promise<void> | undefined
    const task = this.#queue
      .add(
        ({ signal }) => {
          execution = this.#run(job, signal ?? controller.signal)
          return execution
        },
        { id: job.id, signal: controller.signal }
      )
      .catch(async (error: unknown) => {
        // p-queue 会立即拒绝被取消的任务；已启动任务仍需等待抓取协作式退出。
        if (execution) await execution
        if (controller.signal.aborted) {
          const persisted = this.database.syncJobs.get(job.id)
          if (persisted) assignJob(job, persisted)
          return
        }
        const message = error instanceof Error ? error.message : '同步排队失败'
        job.status = 'failed'
        job.error = message
        assignJob(
          job,
          this.database.syncJobs.finish(
            job.id,
            this.#ownerId,
            'failed',
            job.progress,
            job.failures,
            message
          )
        )
      })
      .then(() => undefined)
      .finally(() => {
        clearInterval(heartbeat)
        this.#controllers.delete(job.id)
        this.#deleteActiveJob(job)
      })
    this.#tasks.set(job.id, task)
    return job
  }

  getJob(id: string): SyncJob | undefined {
    const job = this.database.syncJobs.get(id)
    return job ? publicJob(job) : undefined
  }

  isRunning(libraryId: string): boolean {
    return this.database.syncJobs.isLibraryActive(libraryId)
  }

  async wait(id: string): Promise<SyncJob | undefined> {
    const local = this.#tasks.get(id)
    if (local) await local
    while (true) {
      this.database.syncJobs.expire()
      const job = this.getJob(id)
      if (!job || !isActive(job)) return job
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  async close(): Promise<void> {
    for (const job of this.#schedules.values()) job.stop()
    this.#schedules.clear()
    for (const job of this.#jobs.values()) if (isActive(job)) this.cancel(job.id)
    await Promise.all(this.#tasks.values())
    await this.#queue.onIdle()
  }

  async #run(job: SyncJob, signal: AbortSignal): Promise<void> {
    if (!this.database.syncJobs.markRunning(job.id, this.#ownerId, leaseExpiresAt())) {
      const persisted = this.database.syncJobs.get(job.id)
      if (persisted) assignJob(job, persisted)
      return
    }
    job.status = 'running'
    try {
      this.#assertNotCanceled(signal)
      const library = this.database.getLibrary(job.libraryId)
      const documents: Parameters<ServerDatabase['saveDocument']>[1][] = []
      const deletedUrls: string[] = []
      let replaceAll = false
      const result = await crawlSource({
        kind: parseGithubRepositoryUrl(library.url) ? 'github' : 'web',
        firstUrl: library.url,
        hostname: library.hostname,
        scopePath: library.scopePath,
        pageLimit: library.pageLimit,
        initialUrls: this.database.listDocumentUrls(library.id),
        fetchMode: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 5,
        githubPreviousRevision: library.githubRevision,
        githubBlocked: library.githubBlocked,
        signal,
        waitIfPaused: async () => this.#assertNotCanceled(signal),
        crawler: this.browserConfig ? createBrowserCrawler(this.browserConfig) : undefined,
        fetch: this.fetchImpl,
        onDocument: (document) => {
          documents.push(document)
        },
        onSnapshot: (snapshot) => {
          replaceAll = true
          documents.push(...snapshot)
        },
        onError: ({ url, missing }) => {
          if (missing) deletedUrls.push(url)
        },
        onDuplicate: ({ url }) => {
          deletedUrls.push(url)
        },
        onProgress: (progressEvent) => {
          job.progress = progressEvent
          if (
            !this.database.syncJobs.heartbeat(job.id, this.#ownerId, leaseExpiresAt(), job.progress)
          ) {
            this.#controllers.get(job.id)?.abort(new SyncCanceledError('同步已取消'))
          }
        }
      })
      this.#assertNotCanceled(signal)
      const progress = result.progress
      if (progress.succeeded === 0 && progress.failed > 0) {
        throw new Error(`同步失败：${progress.failed} 个页面均未成功`)
      }
      this.#assertNotCanceled(signal)
      this.database.commitCrawl(library.id, {
        jobId: job.id,
        ownerId: this.#ownerId,
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
        this.database.syncJobs.finish(
          job.id,
          this.#ownerId,
          job.status,
          job.progress,
          job.failures,
          null
        )
      )
    } catch (error) {
      if (error instanceof SyncCanceledError) {
        job.status = 'canceled'
      } else {
        if (error instanceof GithubLimitError) {
          this.database.updateGithubBlocked(job.libraryId, {
            revision: error.revision,
            kind: error.kind,
            limitBytes: error.limitBytes
          })
        }
        const message = error instanceof Error ? error.message : '同步失败'
        this.database.finishCrawl(job.libraryId, message)
        job.error = message
        job.status = 'failed'
      }
      assignJob(
        job,
        this.database.syncJobs.finish(
          job.id,
          this.#ownerId,
          job.status === 'canceled' ? 'canceled' : 'failed',
          job.progress,
          job.failures,
          job.error
        )
      )
    }
  }

  #assertNotCanceled(signal: AbortSignal): void {
    if (signal.aborted) throw new SyncCanceledError('同步已取消')
  }

  #deleteActiveJob(job: SyncJob): void {
    if (this.#activeJobsByLibrary.get(job.libraryId) === job) {
      this.#activeJobsByLibrary.delete(job.libraryId)
    }
  }
}

function isActive(job: SyncJob): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'canceling'
}

function leaseExpiresAt(): string {
  return new Date(Date.now() + 30_000).toISOString()
}

function publicJob(job: SyncJob): SyncJob {
  return {
    id: job.id,
    libraryId: job.libraryId,
    status: job.status,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    failures: job.failures,
    error: job.error
  }
}

function assignJob(target: SyncJob, source: SyncJob): void {
  Object.assign(target, publicJob(source))
}
