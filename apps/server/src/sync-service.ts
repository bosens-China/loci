import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { crawlSource, normalizeCronSchedule } from '@loci/core'
import type { CrawlProgress } from '@loci/core'
import { createBrowserlessCrawler } from './browser-crawl.js'
import { ConflictError, ServerDatabase } from './database.js'
import type { SyncJob } from './types.js'

/** 抓取、发布和定时调度统一走这里，保证同一文档库不会并发更新。 */
export class SyncService {
  readonly #jobs = new Map<string, SyncJob>()
  readonly #tasks = new Map<string, Promise<void>>()
  readonly #runningLibraries = new Set<string>()
  readonly #schedules = new Map<string, Cron>()

  constructor(
    private readonly database: ServerDatabase,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly browserEndpoint?: string
  ) {}

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
        if (!this.#runningLibraries.has(libraryId)) this.start(libraryId)
      }
    )
    this.#schedules.set(libraryId, job)
  }

  removeSchedule(libraryId: string): void {
    this.#schedules.get(libraryId)?.stop()
    this.#schedules.delete(libraryId)
  }

  start(libraryId: string): SyncJob {
    this.database.getLibrary(libraryId)
    if (this.#runningLibraries.has(libraryId)) {
      throw new ConflictError('这个文档库已经在同步中')
    }
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
    this.#runningLibraries.add(libraryId)
    const task = this.#run(job).finally(() => this.#runningLibraries.delete(libraryId))
    this.#tasks.set(job.id, task)
    return job
  }

  getJob(id: string): SyncJob | undefined {
    return this.#jobs.get(id)
  }

  isRunning(libraryId: string): boolean {
    return this.#runningLibraries.has(libraryId)
  }

  async wait(id: string): Promise<SyncJob | undefined> {
    await this.#tasks.get(id)
    return this.getJob(id)
  }

  close(): void {
    for (const job of this.#schedules.values()) job.stop()
    this.#schedules.clear()
  }

  async #run(job: SyncJob): Promise<void> {
    job.status = 'running'
    try {
      const library = this.database.getLibrary(job.libraryId)
      const result = await crawlSource({
        firstUrl: library.url,
        hostname: library.hostname,
        pageLimit: library.pageLimit,
        initialUrls: this.database.listDocumentUrls(library.id),
        fetchMode: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 2,
        crawler: this.browserEndpoint ? createBrowserlessCrawler(this.browserEndpoint) : undefined,
        fetch: this.fetchImpl,
        onDocument: (document) => this.database.saveDocument(library.id, document),
        onError: ({ url, missing }) => {
          if (missing) this.database.deleteDocument(library.id, url)
        },
        onProgress: (progressEvent) => {
          job.progress = withoutNode(progressEvent)
        }
      })
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
      const message = error instanceof Error ? error.message : '同步失败'
      this.database.finishCrawl(job.libraryId, message)
      job.error = message
      job.status = 'failed'
    } finally {
      job.finishedAt = new Date().toISOString()
      this.#pruneJobs()
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

function withoutNode(progress: CrawlProgress): CrawlProgress {
  const snapshot = { ...progress }
  delete snapshot.node
  return snapshot
}
