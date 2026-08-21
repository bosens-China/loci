import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LocalJob } from '@loci/shared'
import { listJobs } from '@/api/jobs'

/** 轮询持久任务，使独立 worker 的跨进程更新能刷新 Web Query 缓存。 */
export function useJobEvents(enabled: boolean): void {
  const queryClient = useQueryClient()
  const previousSignature = useRef('')
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    enabled,
    refetchInterval: (query) => (hasActiveJobs(query.state.data) ? 1_000 : 5_000)
  })

  useEffect(() => {
    if (!enabled || !jobs.data) return
    const signature = jobs.data.map((job) => `${job.id}:${job.status}:${job.updatedAt}`).join('|')
    if (signature === previousSignature.current) return
    previousSignature.current = signature
    void queryClient.invalidateQueries({ queryKey: ['sources'] })
    void queryClient.invalidateQueries({ queryKey: ['documents'] })
  }, [enabled, jobs.data, queryClient])
}

function hasActiveJobs(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(
    (job): job is LocalJob =>
      Boolean(job) &&
      typeof job === 'object' &&
      'status' in job &&
      (job.status === 'pending' || job.status === 'running')
  )
}
