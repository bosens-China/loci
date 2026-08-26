import {
  getCloudLibraryContentRemovalRisk,
  type CloudLibrary,
  type CloudLibraryInput,
  type CloudSyncJob
} from '@loci/shared'

export function isAdminJobActive(job: CloudSyncJob): boolean {
  return ['queued', 'running', 'canceling'].includes(job.status)
}

export function latestAdminJobsByLibrary(
  jobs: readonly CloudSyncJob[]
): Record<string, CloudSyncJob> {
  const result: Record<string, CloudSyncJob> = {}
  for (const job of [...jobs].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )) {
    result[job.libraryId] = job
  }
  return result
}

export function mergeAdminJobs(
  current: readonly CloudSyncJob[],
  incoming: readonly CloudSyncJob[]
): CloudSyncJob[] {
  const jobs = new Map(current.map((job) => [job.id, job]))
  for (const job of incoming) jobs.set(job.id, job)
  return [...jobs.values()]
}

export function getAdminSyncPercent(job: CloudSyncJob): number {
  if (job.status === 'completed' || job.status === 'completed_with_errors') return 100
  if (!job.progress) return 0
  const total = job.progress.processed + job.progress.queued
  return total ? Math.round((job.progress.processed / total) * 100) : 0
}

export function availableAdminLibraryIds(
  libraries: readonly CloudLibrary[],
  jobs: Readonly<Record<string, CloudSyncJob>>,
  selected: readonly string[]
): string[] {
  const available = libraries
    .filter((library) => !jobs[library.id] || !isAdminJobActive(jobs[library.id]!))
    .map((library) => library.id)
  const availableSet = new Set(available)
  const selectedAvailable = selected.filter((id) => availableSet.has(id))
  return selected.length ? selectedAvailable : available
}

export function isAdminAuthError(error: unknown): boolean {
  return (
    error instanceof Error && /登录|会话|401|未授权|unauthorized|token|令牌/iu.test(error.message)
  )
}

export function getAdminLibraryRemovalWarning(
  library: CloudLibrary,
  input: CloudLibraryInput
): string | null {
  const risk = getCloudLibraryContentRemovalRisk(library, input)
  if (risk === 'url_changed') {
    return 'Server 会立即清空该文档库现有抓取内容。保存后需要重新同步，成功后才会发布新快照。'
  }
  return risk
    ? 'Server 会立即删除新收录范围之外的正文。保存后需要重新同步，成功后才会发布完整的新快照。'
    : null
}
