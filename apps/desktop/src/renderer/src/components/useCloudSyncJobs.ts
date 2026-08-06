import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CloudSyncJob } from '@loci/shared'
import { isCloudSyncJobActive } from './cloud-sync-progress'
import { queryKeys } from '../query-client'

interface CloudSyncJobsOptions {
  enabled: boolean
  onSettled: () => void
  onAuthError: () => void
}

interface CloudSyncJobsState {
  jobs: Record<string, CloudSyncJob>
  error: string | null
  submit: (libraryIds: string[]) => Promise<CloudSyncJob[]>
  attach: (jobs: CloudSyncJob[]) => void
  cancel: (jobId: string) => Promise<CloudSyncJob>
}

/** 管理员同步任务只在管理页可见时恢复和轮询。 */
export function useCloudSyncJobs({
  enabled,
  onSettled,
  onAuthError
}: CloudSyncJobsOptions): CloudSyncJobsState {
  const client = useQueryClient()
  const previousActiveIds = useRef<Set<string>>(new Set())
  const query = useQuery({
    queryKey: queryKeys.cloudSyncJobs,
    queryFn: window.api.listCloudSyncJobs,
    enabled,
    refetchInterval: ({ state }) => (state.data?.some(isCloudSyncJobActive) ? 1_000 : false)
  })
  const jobs = useMemo(() => latestJobsByLibrary(query.data ?? []), [query.data])

  const attach = useCallback(
    (items: CloudSyncJob[]): void => {
      client.setQueryData<CloudSyncJob[]>(queryKeys.cloudSyncJobs, (current = []) => {
        const byId = new Map(current.map((job) => [job.id, job]))
        for (const job of items) byId.set(job.id, job)
        return [...byId.values()]
      })
    },
    [client]
  )

  useEffect(() => {
    if (query.error && isAuthError(query.error)) onAuthError()
  }, [onAuthError, query.error])

  useEffect(() => {
    const current = new Set(
      Object.values(jobs)
        .filter(isCloudSyncJobActive)
        .map((job) => job.id)
    )
    if ([...previousActiveIds.current].some((id) => !current.has(id))) onSettled()
    previousActiveIds.current = current
  }, [jobs, onSettled])

  const submitMutation = useMutation({
    mutationFn: window.api.syncCloudLibraries,
    onSuccess: attach
  })
  const cancelMutation = useMutation({
    mutationFn: window.api.cancelCloudSyncJob,
    onSuccess: (job) => attach([job])
  })
  const failure = query.error ?? submitMutation.error ?? cancelMutation.error

  return {
    jobs,
    error: failure ? errorMessage(failure, '同步任务读取失败') : null,
    submit: (libraryIds) => submitMutation.mutateAsync(libraryIds),
    attach,
    cancel: (jobId) => cancelMutation.mutateAsync(jobId)
  }
}

export function latestJobsByLibrary(items: readonly CloudSyncJob[]): Record<string, CloudSyncJob> {
  const result: Record<string, CloudSyncJob> = {}
  for (const job of [...items].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )) {
    result[job.libraryId] = job
  }
  return result
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isAuthError(error: unknown): boolean {
  const message = errorMessage(error, '')
  return message.includes('会话') || message.includes('登录')
}
