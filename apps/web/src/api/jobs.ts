import type { EnqueueLocalJobResult, LocalJob } from '@loci/shared'
import { request } from '@/api/client'

export async function listJobs(): Promise<LocalJob[]> {
  return (await request.get<LocalJob[]>('/api/jobs')).data
}

export async function enqueueSourceSync(sourceId: string): Promise<EnqueueLocalJobResult> {
  return (await request.post<EnqueueLocalJobResult>('/api/jobs/source-sync', { sourceId })).data
}

export async function cancelJob(id: string): Promise<LocalJob> {
  return (await request.post<LocalJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`)).data
}

export type JobControlAction = 'pause' | 'resume' | 'stop'

export async function controlJob(id: string, action: JobControlAction): Promise<LocalJob> {
  return (await request.post<LocalJob>(`/api/jobs/${encodeURIComponent(id)}/${action}`)).data
}

export async function setJobPriority(id: string, priority: number): Promise<LocalJob> {
  return (await request.put<LocalJob>(`/api/jobs/${encodeURIComponent(id)}/priority`, { priority }))
    .data
}

export async function controlAllJobs(
  action: 'pause-all' | 'resume-all',
  hostname?: string
): Promise<{ changed: number }> {
  return (await request.post<{ changed: number }>(`/api/jobs/${action}`, { hostname })).data
}
