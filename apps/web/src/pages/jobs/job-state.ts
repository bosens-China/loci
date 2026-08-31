import { formatLocalDate, type LocalJob } from '@loci/shared'

export type JobViewStatus = LocalJob['status'] | 'pausing' | 'paused' | 'stopping' | 'stopped'

export interface JobFilters {
  query: string
  date: string
  status: JobViewStatus | 'all'
}

export interface HostnameJobGroup {
  hostname: string
  jobs: LocalJob[]
  active: number
  paused: number
  failed: number
  processed: number
  queued: number
  contentBytes: number
}

export interface DomainConcurrencySummary {
  limit: number
  totalUsed: number
  utilizationPercent: number
  allocations: Map<string, number>
}

export type JobProgressView =
  | {
      kind: 'indeterminate'
      processed: number
      current: string
    }
  | {
      kind: 'determinate'
      processed: number
      total: number
      percent: number
      current: string
    }

export const localJobElementId = (jobId: string): string => `local-job-${jobId}`

export function isActiveJob(job: LocalJob): boolean {
  const status = jobViewStatus(job)
  return (
    status === 'pending' || status === 'running' || status === 'pausing' || status === 'stopping'
  )
}

export function jobViewStatus(job: LocalJob): JobViewStatus {
  if (job.status === 'running' && job.stopRequested) return 'stopping'
  if (job.status === 'running' && job.pauseRequested) return 'pausing'
  if (job.status === 'pending' && job.paused) return 'paused'
  if (job.status === 'completed' && job.partial) return 'stopped'
  return job.status
}

/** 失败筛选统一包含执行失败与用户取消，确保筛选结果和汇总数量一致。 */
export function isFailedJob(job: LocalJob): boolean {
  const status = jobViewStatus(job)
  return status === 'failed' || status === 'cancelled'
}

export function groupJobsByHostname(jobs: readonly LocalJob[]): HostnameJobGroup[] {
  const groups = new Map<string, LocalJob[]>()
  for (const job of jobs) {
    const current = groups.get(job.hostname)
    if (current) current.push(job)
    else groups.set(job.hostname, [job])
  }
  return [...groups.entries()]
    .map(([hostname, items]) => summarizeGroup(hostname, items))
    .sort((left, right) => {
      if (left.active !== right.active) return right.active - left.active
      return left.hostname.localeCompare(right.hostname)
    })
}

export function filterJobs(
  jobs: readonly LocalJob[],
  sourceNames: ReadonlyMap<string, string>,
  filters: JobFilters
): LocalJob[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return jobs.filter((job) => {
    if (
      filters.status !== 'all' &&
      (filters.status === 'failed' ? !isFailedJob(job) : jobViewStatus(job) !== filters.status)
    ) {
      return false
    }
    if (filters.date && formatLocalDate(job.scheduledAt) !== filters.date) return false
    if (!query) return true
    return [job.hostname, job.sourceId, sourceNames.get(job.sourceId) ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(query)
    )
  })
}

export function estimateRemainingMs(job: LocalJob, now = Date.now()): number | null {
  const progress = job.result
  if (!job.startedAt || !progress || progress.processed < 1) return null
  const total = Math.max(progress.queued, progress.processed)
  const remaining = total - progress.processed
  if (remaining <= 0) return 0
  const elapsed = Math.max(0, now - new Date(job.startedAt).getTime())
  return Math.round((elapsed / progress.processed) * remaining)
}

/** 将持久任务进度归一为“准备中”与“可计算百分比”两种稳定展示状态。 */
export function getJobProgressView(job: LocalJob): JobProgressView {
  const processed = job.result?.processed ?? 0
  const total = Math.max(job.result?.queued ?? 0, processed)
  const current =
    job.result?.node?.title ?? (job.status === 'pending' ? '等待任务开始' : '正在准备同步')
  if (total === 0) return { kind: 'indeterminate', processed, current }
  return {
    kind: 'determinate',
    processed,
    total,
    percent: Math.min(100, Math.round((processed / total) * 100)),
    current
  }
}

/**
 * 按照任务优先级、待抓取页数需求量与创建顺序，精确分配域名并发配额：
 * 1. 若仅 1 个活跃任务，独占所有可用并发（吃满配置上限或其所需页数）；
 * 2. 多任务时按优先级从高到低分配；高优先级满足后，若有余量再流入低优先级；
 * 3. 同优先级任务按入队顺序轮流 +1 分配并发余量；超出上限的任务排队。
 */
export function calculateDomainConcurrency(
  activeJobs: readonly LocalJob[],
  limit: number
): DomainConcurrencySummary {
  if (limit <= 0 || activeJobs.length === 0) {
    return { limit, totalUsed: 0, utilizationPercent: 0, allocations: new Map() }
  }

  // 按优先级降序，同优先级按调度创建时间升序排序
  const sortedJobs = [...activeJobs].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  })

  const allocations = new Map<string, number>()
  for (const job of sortedJobs) {
    allocations.set(job.id, 0)
  }

  let remaining = limit

  if (sortedJobs.length === 1) {
    const single = sortedJobs[0]
    const needed = getRemainingPages(single)
    const allocated = Math.min(remaining, needed)
    allocations.set(single.id, allocated)
    remaining -= allocated
  } else {
    // 按优先级分组
    const priorityGroups = new Map<number, LocalJob[]>()
    for (const job of sortedJobs) {
      const list = priorityGroups.get(job.priority) ?? []
      list.push(job)
      priorityGroups.set(job.priority, list)
    }

    const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => b - a)

    for (const prio of sortedPriorities) {
      if (remaining <= 0) break
      const jobsInPrio = priorityGroups.get(prio) ?? []

      // 针对同优先级任务：按顺序循环轮流分配 +1 直到满足或并发耗尽
      let canAllocateMore = true
      while (remaining > 0 && canAllocateMore) {
        canAllocateMore = false
        for (const job of jobsInPrio) {
          if (remaining <= 0) break
          const currentAllocated = allocations.get(job.id) ?? 0
          const needed = getRemainingPages(job)
          if (currentAllocated < needed) {
            allocations.set(job.id, currentAllocated + 1)
            remaining -= 1
            canAllocateMore = true
          }
        }
      }
    }
  }

  const totalUsed = limit - remaining
  const utilizationPercent = limit > 0 ? Math.min(100, Math.round((totalUsed / limit) * 100)) : 0

  return {
    limit,
    totalUsed,
    utilizationPercent,
    allocations
  }
}

function getRemainingPages(job: LocalJob): number {
  if (!job.result || job.result.queued === 0) {
    return Infinity
  }
  const remaining = job.result.queued - job.result.processed
  return remaining > 0 ? remaining : 1
}

/** 每个文档库只保留更新时间最新的活动同步任务，供任务中心外的轻量进度入口复用。 */
export function getLatestActiveJobsBySource(
  jobs: readonly LocalJob[]
): ReadonlyMap<string, LocalJob> {
  const activeJobs = new Map<string, LocalJob>()
  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'running') continue
    const current = activeJobs.get(job.sourceId)
    if (!current || job.updatedAt > current.updatedAt) activeJobs.set(job.sourceId, job)
  }
  return activeJobs
}

/** 用任务接口返回的新状态更新缓存，同时保留其他任务。 */
export function upsertLocalJob(jobs: readonly LocalJob[], incoming: LocalJob): LocalJob[] {
  const found = jobs.some((job) => job.id === incoming.id)
  return found ? jobs.map((job) => (job.id === incoming.id ? incoming : job)) : [incoming, ...jobs]
}

function summarizeGroup(hostname: string, jobs: LocalJob[]): HostnameJobGroup {
  return {
    hostname,
    jobs,
    active: jobs.filter(isActiveJob).length,
    paused: jobs.filter((job) => jobViewStatus(job) === 'paused').length,
    failed: jobs.filter(isFailedJob).length,
    processed: jobs.reduce((total, job) => total + (job.result?.processed ?? 0), 0),
    queued: jobs.reduce(
      (total, job) => total + Math.max(job.result?.queued ?? 0, job.result?.processed ?? 0),
      0
    ),
    contentBytes: jobs.reduce((total, job) => total + job.contentBytes, 0)
  }
}
