import type { CloudLibrary, CloudLibraryInput, CloudSyncJob } from '@loci/shared'

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

export function hasAdminLibraryUrlChanged(
  library: CloudLibrary,
  input: CloudLibraryInput
): boolean {
  return library.url !== input.url
}
