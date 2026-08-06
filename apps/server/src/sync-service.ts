import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import PQueue from 'p-queue'
import { crawlSource, normalizeCronSchedule } from '@loci/core'
import type { CrawlProgress } from '@loci/core'
import { createBrowserCrawler } from './browser-crawl.js'
import type { BrowserConfig } from './browser-config.js'
import { ServerDatabase } from './database.js'
import type { SyncJob } from './types.js'

class SyncCanceledError extends Error {}

/** 抓取、发布和定时调度统一走这里，保证同一文档库不会并发更新。 */
export class SyncService {
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
    return ids.map(
      (libraryId) => this.#activeJobsByLibrary.get(libraryId) ?? this.#enqueue(libraryId)
    )
  }

  listJobs(): SyncJob[] {
    return [...this.#jobs.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    )
  }

  cancel(id: string): SyncJob | undefined {
    const job = this.#jobs.get(id)
    if (!job) return undefined
    if (!isActive(job)) return job
    if (job.status === 'queued') {
      job.status = 'canceled'
      job.finishedAt = new Date().toISOString()
      this.#deleteActiveJob(job)
      this.#controllers.get(id)?.abort(new SyncCanceledError('同步已取消'))
      return job
    }
    job.status = 'canceling'
    this.#controllers.get(id)?.abort(new SyncCanceledError('同步已取消'))
    return job
  }

  #enqueue(libraryId: string): SyncJob {
    const job: SyncJob = {
      id: randomUUID(),
      libraryId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      progress: null,
      failures: [],
      error: null
    }
    this.#jobs.set(job.id, job)
    this.#activeJobsByLibrary.set(libraryId, job)
    const controller = new AbortController()
    this.#controllers.set(job.id, controller)
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
          if (isActive(job)) {
            job.status = 'canceled'
            job.finishedAt = new Date().toISOString()
          }
          return
        }
        const message = error instanceof Error ? error.message : '同步排队失败'
        job.status = 'failed'
        job.error = message
        job.finishedAt = new Date().toISOString()
      })
      .then(() => undefined)
      .finally(() => {
        this.#controllers.delete(job.id)
        this.#deleteActiveJob(job)
        this.#pruneJobs()
      })
    this.#tasks.set(job.id, task)
    return job
  }

  getJob(id: string): SyncJob | undefined {
    return this.#jobs.get(id)
  }

  isRunning(libraryId: string): boolean {
    return this.#activeJobsByLibrary.has(libraryId)
  }

  async wait(id: string): Promise<SyncJob | undefined> {
    await this.#tasks.get(id)
    return this.getJob(id)
  }

  async close(): Promise<void> {
    for (const job of this.#schedules.values()) job.stop()
    this.#schedules.clear()
    for (const job of this.listJobs().filter(isActive)) this.cancel(job.id)
    await Promise.all(this.#tasks.values())
    await this.#queue.onIdle()
  }

  async #run(job: SyncJob, signal: AbortSignal): Promise<void> {
    job.status = 'running'
    try {
      this.#assertNotCanceled(signal)
      const library = this.database.getLibrary(job.libraryId)
      const result = await crawlSource({
        firstUrl: library.url,
        hostname: library.hostname,
        scopePath: library.scopePath,
        pageLimit: library.pageLimit,
        initialUrls: this.database.listDocumentUrls(library.id),
        fetchMode: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 5,
        waitIfPaused: async () => this.#assertNotCanceled(signal),
        crawler: this.browserConfig ? createBrowserCrawler(this.browserConfig) : undefined,
        fetch: this.fetchImpl,
        onDocument: (document) => this.database.saveDocument(library.id, document),
        onError: ({ url, missing }) => {
          if (missing) this.database.deleteDocument(library.id, url)
        },
        onProgress: (progressEvent) => {
          job.progress = withoutNode(progressEvent)
        }
      })
      this.#assertNotCanceled(signal)
      const progress = result.progress
      if (progress.succeeded === 0 && progress.failed > 0) {
        throw new Error(`同步失败：${progress.failed} 个页面均未成功`)
      }
      this.database.finishCrawl(library.id, null)
      this.database.publishSnapshot(library.id)
      job.progress = withoutNode(progress)
      job.failures = progress.failures ?? []
      job.status = progress.failed > 0 ? 'completed_with_errors' : 'completed'
    } catch (error) {
      if (error instanceof SyncCanceledError) {
        job.status = 'canceled'
      } else {
        const message = error instanceof Error ? error.message : '同步失败'
        this.database.finishCrawl(job.libraryId, message)
        job.error = message
        job.status = 'failed'
      }
    } finally {
      job.finishedAt = new Date().toISOString()
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

  #pruneJobs(): void {
    for (const [id, item] of this.#jobs) {
      if (this.#jobs.size <= 100) return
      if (!item.finishedAt) continue
      this.#jobs.delete(id)
      this.#tasks.delete(id)
    }
  }
}

function isActive(job: SyncJob): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'canceling'
}

function withoutNode(progress: CrawlProgress): CrawlProgress {
  const snapshot = { ...progress }
  delete snapshot.node
  return snapshot
}
