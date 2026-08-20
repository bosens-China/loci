import { randomUUID } from 'node:crypto'
import type { LocalJob } from './local-job-database.js'
import type { BrowserInstallPrompt } from './browser-crawler.js'
import type { LocalRuntime } from './local-runtime.js'

export interface LocalJobRunnerOptions {
  owner?: string
  concurrency?: number
  pollIntervalMs?: number
  leaseMs?: number
  onJobChange?: (job: LocalJob) => void
  onBrowserMissing?: BrowserInstallPrompt
}

export interface LocalJobRunner {
  owner: string
  start: () => void
  runOnce: () => Promise<number>
  stop: () => Promise<void>
  activeCount: () => number
  runMaintenance: <T>(action: () => T | Promise<T>) => Promise<T>
}

interface ActiveJob {
  controller: AbortController
  promise: Promise<void>
}

/** 轮询持久队列；进程退出时释放任务，其他服务实例可从 lease 安全接管。 */
export function createLocalJobRunner(
  runtime: LocalRuntime,
  options: LocalJobRunnerOptions = {}
): LocalJobRunner {
  const owner = options.owner ?? `service-${process.pid}-${randomUUID()}`
  const concurrency = clamp(options.concurrency ?? 3, 1, 16)
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 1_000)
  const leaseMs = Math.max(5_000, options.leaseMs ?? 30_000)
  const heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3))
  const active = new Map<string, ActiveJob>()
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let ticking = false
  let stopping = false
  let maintaining = false

  const startPolling = (): void => {
    if (pollTimer || stopping || maintaining) return
    void runOnce()
    pollTimer = setInterval(() => void runOnce(), pollIntervalMs)
    pollTimer.unref?.()
  }

  const publish = (jobId: string): void => {
    const job = runtime.database.getLocalJob(jobId)
    if (job) options.onJobChange?.(job)
  }

  const execute = (job: LocalJob, controller: AbortController): Promise<void> =>
    (async () => {
      const heartbeat = setInterval(() => {
        const current = runtime.database.getLocalJob(job.id)
        if (current?.cancelRequested) controller.abort(new Error('任务已取消'))
        runtime.database.heartbeatLocalJob(job.id, owner, leaseMs)
        publish(job.id)
      }, heartbeatMs)
      heartbeat.unref?.()
      try {
        if (job.kind === 'source_sync') {
          const result = await runtime.crawlSource(
            job.sourceId,
            undefined,
            options.onBrowserMissing,
            controller.signal
          )
          runtime.database.completeLocalJob(job.id, owner, result)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '后台任务执行失败'
        if (stopping)
          runtime.database.releaseLocalJob(job.id, owner, '后台服务正在停止，任务等待恢复')
        else runtime.database.failLocalJob(job.id, owner, message)
      } finally {
        clearInterval(heartbeat)
        active.delete(job.id)
        publish(job.id)
      }
    })()

  const runOnce = async (): Promise<number> => {
    if (ticking || stopping || maintaining) return 0
    ticking = true
    try {
      for (const [jobId, item] of active) {
        if (runtime.database.getLocalJob(jobId)?.cancelRequested) {
          item.controller.abort(new Error('任务已取消'))
        }
      }
      runtime.database.refreshSourceSchedules()
      for (const result of runtime.database.enqueueDueSourceSchedules()) {
        options.onJobChange?.(result.job)
      }
      let claimed = 0
      while (active.size < concurrency) {
        const job = runtime.database.claimNextLocalJob(owner, leaseMs)
        if (!job) break
        const controller = new AbortController()
        const promise = execute(job, controller)
        active.set(job.id, { controller, promise })
        options.onJobChange?.(job)
        claimed += 1
      }
      return claimed
    } finally {
      ticking = false
    }
  }

  return {
    owner,
    start: startPolling,
    runOnce,
    stop: async () => {
      if (stopping) return
      stopping = true
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = undefined
      for (const item of active.values()) item.controller.abort(new Error('后台服务正在停止'))
      await Promise.allSettled([...active.values()].map((item) => item.promise))
    },
    activeCount: () => active.size,
    runMaintenance: async <T>(action: () => T | Promise<T>): Promise<T> => {
      if (stopping) throw new Error('后台服务正在停止')
      if (maintaining) throw new Error('已有数据维护操作正在执行')
      const resumePolling = Boolean(pollTimer)
      maintaining = true
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = undefined
      while (ticking) await new Promise((resolve) => setTimeout(resolve, 0))
      if (active.size > 0) {
        maintaining = false
        if (resumePolling) startPolling()
        throw new Error('仍有同步任务正在执行，请等待完成后重试')
      }
      try {
        return await action()
      } finally {
        maintaining = false
        if (resumePolling) startPolling()
      }
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}
