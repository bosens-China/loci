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
