import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Cron } from 'croner'
import PQueue from 'p-queue'
import { normalizeCronSchedule } from '@loci/core'
import {
  createRevisionEventStream,
  type RevisionEventStream,
  type ServerResourceRevisions
} from '@loci/shared'
import type { BrowserConfig } from './browser-config.js'
import { checkServerBrowserStatus } from './browser-status.js'
import type { ServerBrowserStatus } from '@loci/shared'
import type { SaveServerCrawlSettingsInput, ServerCrawlSettings } from '@loci/shared'
import { ServerDatabase } from './database.js'
import { runServerSyncJob } from './sync-job-runner.js'
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
  readonly #domainQueues = new Map<string, PQueue>()
  readonly #queue: PQueue
  readonly resourceEvents: RevisionEventStream<ServerResourceRevisions>

  constructor(
    private readonly database: ServerDatabase,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly browserConfig?: BrowserConfig
  ) {
    this.#queue = new PQueue({
      concurrency: database.crawlSettings.get().maxConcurrentJobs
    })
    this.resourceEvents = createRevisionEventStream(() => database.resourceRevisions.get(), 1_000)
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
        if (!this.isRunning(libraryId)) this.start(libraryId, 'scheduled')
      }
    )
    this.#schedules.set(libraryId, job)
  }

  removeSchedule(libraryId: string): void {
    this.#schedules.get(libraryId)?.stop()
    this.#schedules.delete(libraryId)
  }

  start(libraryId: string, trigger: 'manual' | 'scheduled' = 'manual'): SyncJob {
    return this.startMany([libraryId], trigger)[0]!
  }

  startMany(libraryIds: readonly string[], trigger: 'manual' | 'scheduled' = 'manual'): SyncJob[] {
    const ids = [...new Set(libraryIds)]
    const libraries = ids.map((libraryId) => this.database.getLibrary(libraryId))
    if (trigger === 'manual') {
      const selectedIds = new Set(ids)
      const selectedHostnames = new Set(libraries.map((library) => library.hostname))
      for (const job of this.listJobs()) {
        if (
          isActive(job) &&
          !selectedIds.has(job.libraryId) &&
          selectedHostnames.has(job.hostname)
        ) {
          this.pause(job.id)
        }
      }
    }
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

  getBrowserStatus(): Promise<ServerBrowserStatus> {
    return checkServerBrowserStatus(this.browserConfig)
  }

  getCrawlSettings(): ServerCrawlSettings {
    return this.database.crawlSettings.get()
  }

  saveCrawlSettings(input: SaveServerCrawlSettingsInput): ServerCrawlSettings {
    const saved = this.database.crawlSettings.save(input)
    this.#queue.concurrency = saved.maxConcurrentJobs
    return saved
  }

  cancel(id: string): SyncJob | undefined {
    const persisted = this.database.syncJobs.cancel(id)
    if (!persisted) return undefined
    const local = this.#jobs.get(id)
    if (local) assignJob(local, persisted)
    this.#controllers.get(id)?.abort(new SyncCanceledError('同步已取消'))
    if (!local && persisted.status === 'canceled') this.#cleanupCanceledEmptyLibrary(persisted)
    return local ?? persisted
  }

  pause(id: string): SyncJob | undefined {
    return this.#updateLocalJob(this.database.syncJobs.pause(id))
  }

  resume(id: string): SyncJob | undefined {
    const persisted = this.database.syncJobs.resume(id, this.#ownerId, leaseExpiresAt())
    if (!persisted) return undefined
    const local = this.#updateLocalJob(persisted)!
    if (!this.#controllers.has(id) && local.status === 'queued') return this.#enqueue(local)
    return local
  }

  stop(id: string): SyncJob | undefined {
    return this.#updateLocalJob(this.database.syncJobs.stop(id))
  }

  setPriority(id: string, priority: number): SyncJob | undefined {
    const job = this.#updateLocalJob(this.database.syncJobs.setPriority(id, priority))
    if (!job) return undefined
    trySetQueuePriority(this.#domainQueues.get(job.hostname), id, job.priority)
    trySetQueuePriority(this.#queue, id, job.priority)
    return job
  }

  controlMany(action: 'pause' | 'resume', hostname?: string): number {
    const jobs = this.listJobs().filter(
      (job) =>
        (!hostname || job.hostname === hostname) &&
        (job.status === 'queued' ||
          job.status === 'running' ||
          (action === 'resume' && job.partial))
    )
    let changed = 0
    for (const job of jobs) {
      const alreadyApplied = action === 'pause' ? job.pauseRequested || job.paused : !job.paused
      const current = action === 'pause' ? this.pause(job.id) : this.resume(job.id)
      if (current && !alreadyApplied) changed += 1
    }
    return changed
  }

  #enqueue(job: SyncJob): SyncJob {
    this.#queue.concurrency = this.database.crawlSettings.get().maxConcurrentJobs
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
    const hostname = this.database.getLibrary(job.libraryId).hostname
    const domainQueue = this.#domainQueues.get(hostname) ?? new PQueue({ concurrency: 1 })
    this.#domainQueues.set(hostname, domainQueue)
    const task = domainQueue
      .add(
        () =>
          this.#queue.add(
            ({ signal }) => {
              execution = this.#run(job, signal ?? controller.signal)
              return execution
            },
            { id: job.id, signal: controller.signal, priority: job.priority }
          ),
        { id: job.id, signal: controller.signal, priority: job.priority }
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
        this.#cleanupCanceledEmptyLibrary(job)
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
    this.resourceEvents.close()
    for (const job of this.#schedules.values()) job.stop()
    this.#schedules.clear()
    for (const job of this.#jobs.values()) if (isActive(job)) this.cancel(job.id)
    await Promise.all(this.#tasks.values())
    await this.#queue.onIdle()
  }

  async #run(job: SyncJob, signal: AbortSignal): Promise<void> {
    while (!this.database.syncJobs.markRunning(job.id, this.#ownerId, leaseExpiresAt())) {
      const persisted = this.database.syncJobs.get(job.id)
      if (persisted) assignJob(job, persisted)
      if (!persisted || persisted.status !== 'queued') return
      await delay(50, undefined, { signal })
    }
    job.status = 'running'
    await runServerSyncJob({
      database: this.database,
      fetchImpl: this.fetchImpl,
      browserConfig: this.browserConfig,
      ownerId: this.#ownerId,
      job,
      signal,
      onLeaseLost: () => this.#controllers.get(job.id)?.abort(new SyncCanceledError('同步已取消'))
    })
  }

  #updateLocalJob(persisted: SyncJob | undefined): SyncJob | undefined {
    if (!persisted) return undefined
    const local = this.#jobs.get(persisted.id)
    if (local) assignJob(local, persisted)
    return local ?? publicJob(persisted)
  }

  #deleteActiveJob(job: SyncJob): void {
    if (this.#activeJobsByLibrary.get(job.libraryId) === job) {
      this.#activeJobsByLibrary.delete(job.libraryId)
    }
  }

  #cleanupCanceledEmptyLibrary(job: SyncJob): void {
    if (job.status !== 'canceled') return
    try {
      const library = this.database.getLibrary(job.libraryId)
      if (library.pages > 0 || library.revision) return
      this.removeSchedule(library.id)
      this.database.deleteLibrary(library.id)
    } catch {
      // 跨进程取消可能已由任务所有者完成同一清理。
    }
  }
}

function trySetQueuePriority(queue: PQueue | undefined, id: string, priority: number): void {
  if (!queue) return
  try {
    queue.setPriority(id, priority)
  } catch {
    // 已进入执行态时队列中不再有该 ID；持久优先级仍已保存，后续恢复继续使用。
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
    hostname: job.hostname,
    status: job.status,
    priority: job.priority,
    paused: job.paused,
    pauseRequested: job.pauseRequested,
    stopRequested: job.stopRequested,
    partial: job.partial,
    contentBytes: job.contentBytes,
    remainingCount: job.remainingCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    failures: job.failures,
    error: job.error
  }
}

function assignJob(target: SyncJob, source: SyncJob): void {
  Object.assign(target, publicJob(source))
}
