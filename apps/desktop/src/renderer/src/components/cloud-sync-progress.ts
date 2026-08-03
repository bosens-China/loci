import type { CloudSyncJob } from '@loci/shared'

export function isCloudSyncJobActive(job: CloudSyncJob): boolean {
  return job.status === 'queued' || job.status === 'running'
}

export function getCloudSyncPercent(job: CloudSyncJob): number {
  if (job.status === 'completed' || job.status === 'completed_with_errors') return 100
  const progress = job.progress
  if (!progress) return 0
  const total = progress.processed + progress.queued
  return total ? Math.round((progress.processed / total) * 100) : 0
}
