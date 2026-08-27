import { App } from 'antd'
import type { CloudSyncJob } from '@loci/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { controlAdminJob, controlAllAdminJobs, setAdminJobPriority } from '@/api/admin'
import { ADMIN_JOBS_KEY } from '@/pages/admin/admin-query-keys'
import { mergeAdminJobs } from '@/pages/admin/admin-state'

type JobAction = 'pause' | 'resume' | 'stop' | 'cancel'

export function useAdminJobControls(): {
  control: (id: string, action: JobAction) => void
  setPriority: (id: string, priority: number) => void
  controlDomain: (hostname: string | undefined, action: 'pause-all' | 'resume-all') => void
  pendingKey: string | undefined
} {
  const client = useQueryClient()
  const { message } = App.useApp()
  const item = useMutation({
    mutationFn: ({ id, action }: { id: string; action: JobAction }) => controlAdminJob(id, action),
    onSuccess: (job, variables) => {
      mergeIntoCache(client, job)
      void message.success(actionMessages[variables.action])
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const priority = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => setAdminJobPriority(id, value),
    onSuccess: (job) => {
      mergeIntoCache(client, job)
      void message.success('Server 任务优先级已调整')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const bulk = useMutation({
    mutationFn: ({ hostname, action }: { hostname?: string; action: 'pause-all' | 'resume-all' }) =>
      controlAllAdminJobs(action, hostname),
    onSuccess: ({ changed }, variables) => {
      void client.invalidateQueries({ queryKey: ADMIN_JOBS_KEY })
      void message.success(
        `${variables.action === 'pause-all' ? '已暂停' : '已恢复'} ${changed} 个 Server 任务`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const pendingKey = item.isPending
    ? `${item.variables.action}:${item.variables.id}`
    : priority.isPending
      ? `priority:${priority.variables.id}`
      : bulk.isPending
        ? `${bulk.variables.action}:${bulk.variables.hostname ?? '*'}`
        : undefined
  return {
    control: (id, action) => item.mutate({ id, action }),
    setPriority: (id, value) => priority.mutate({ id, value }),
    controlDomain: (hostname, action) => bulk.mutate({ hostname, action }),
    pendingKey
  }
}

function mergeIntoCache(client: ReturnType<typeof useQueryClient>, job: CloudSyncJob): void {
  client.setQueryData<CloudSyncJob[]>(ADMIN_JOBS_KEY, (current = []) =>
    mergeAdminJobs(current, [job])
  )
}

const actionMessages: Record<JobAction, string> = {
  pause: 'Server 任务将在当前批次后暂停',
  resume: 'Server 任务已恢复',
  stop: 'Server 任务将在当前批次后结束并保留内容',
  cancel: '已提交 Server 任务取消请求'
}
