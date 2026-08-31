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

export function jobViewStatus(job: LocalJob): JobViewStatus {
  if (job.status === 'running' && job.stopRequested) return 'stopping'
  if (job.status === 'running' && job.pauseRequested) return 'pausing'
  if (job.status === 'pending' && job.paused) return 'paused'
  if (job.status === 'completed' && job.partial) return 'stopped'
  return job.status
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
    if (filters.status !== 'all' && jobViewStatus(job) !== filters.status) return false
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
    active: jobs.filter((job) => {
      const status = jobViewStatus(job)
      return (
        status === 'pending' ||
        status === 'running' ||
        status === 'pausing' ||
        status === 'stopping'
      )
    }).length,
    paused: jobs.filter((job) => jobViewStatus(job) === 'paused').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    processed: jobs.reduce((total, job) => total + (job.result?.processed ?? 0), 0),
    queued: jobs.reduce(
      (total, job) => total + Math.max(job.result?.queued ?? 0, job.result?.processed ?? 0),
      0
    ),
    contentBytes: jobs.reduce((total, job) => total + job.contentBytes, 0)
  }
}
