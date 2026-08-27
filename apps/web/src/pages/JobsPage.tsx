import { useMemo, useState } from 'react'
import { CaretRightOutlined, PauseOutlined, SearchOutlined } from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Empty, Input, Select } from 'antd'
import {
  cancelJob,
  controlAllJobs,
  controlJob,
  listJobs,
  setJobPriority,
  type JobControlAction
} from '@/api/jobs'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { PageHeader } from '@/components/PageHeader'
import { useCurrentTime } from '@/hooks/use-current-time'
import { JobDomainCard } from '@/pages/jobs/JobDomainCard'
import {
  filterJobs,
  groupJobsByHostname,
  type JobFilters,
  type JobViewStatus
} from '@/pages/jobs/job-state'

const JOBS_KEY = ['jobs'] as const

type ItemAction = JobControlAction | 'cancel' | 'continue'

export function JobsPage(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const now = useCurrentTime()
  const [filters, setFilters] = useState<JobFilters>({ query: '', date: '', status: 'all' })
  const jobs = useQuery({
    queryKey: JOBS_KEY,
    queryFn: listJobs,
    refetchInterval: ({ state }) =>
      state.data?.some((job) => job.status === 'pending' || job.status === 'running')
        ? 1_000
        : 5_000
  })
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const sourceNames = useMemo(
    () => new Map((sources.data ?? []).map((source) => [source.id, source.name])),
    [sources.data]
  )
  const groups = useMemo(
    () => groupJobsByHostname(filterJobs(jobs.data ?? [], sourceNames, filters)),
    [filters, jobs.data, sourceNames]
  )

  const itemControl = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ItemAction }) =>
      action === 'cancel'
        ? cancelJob(id)
        : controlJob(id, action === 'continue' ? 'resume' : action),
    onSuccess: (job, value) => {
      updateCachedJob(client, job)
      void message.success(actionSuccess[value.action])
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const bulkControl = useMutation({
    mutationFn: ({ action, hostname }: { action: 'pause-all' | 'resume-all'; hostname?: string }) =>
      controlAllJobs(action, hostname),
    onSuccess: ({ changed }, value) => {
      void client.invalidateQueries({ queryKey: JOBS_KEY })
      void message.success(
        `${value.action === 'pause-all' ? '已暂停' : '已恢复'} ${changed} 个任务`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const priority = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => setJobPriority(id, value),
    onSuccess: (job) => {
      updateCachedJob(client, job)
      void message.success('优先级已调整')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const pendingAction = pendingActionKey(itemControl, bulkControl, priority)

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="后台任务"
        description="域名共享抓取队列与限速；不同域名保持并发，关闭 UI 不会中断任务。"
        action={
          <div className="flex gap-2">
            <ConfirmedActionButton
              title="暂停全部活动任务？"
              description="已经发出的页面请求会完成，所有域名将在下一批次暂停。"
              label="全部暂停"
              icon={<PauseOutlined />}
              type="default"
              size="middle"
              loading={bulkControl.isPending && bulkControl.variables.action === 'pause-all'}
              onConfirm={() => bulkControl.mutate({ action: 'pause-all' })}
            />
            <ConfirmedActionButton
              title="恢复全部暂停任务？"
              description="任务会继续使用原任务 ID 和已保存的检查点。"
              label="全部恢复"
              icon={<CaretRightOutlined />}
              type="default"
              size="middle"
              loading={bulkControl.isPending && bulkControl.variables.action === 'resume-all'}
              onConfirm={() => bulkControl.mutate({ action: 'resume-all' })}
            />
          </div>
        }
      />
      <JobFiltersBar value={filters} onChange={setFilters} />
      <AsyncState
        loading={jobs.isLoading || sources.isLoading}
        error={jobs.error ?? sources.error}
        onRetry={() => void Promise.all([jobs.refetch(), sources.refetch()])}
      >
        {groups.length ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <JobDomainCard
                key={group.hostname}
                group={group}
                now={now}
                sourceNames={sourceNames}
                pendingAction={pendingAction}
                onJobAction={(job, action) => itemControl.mutate({ id: job.id, action })}
                onDomainAction={(hostname, action) => bulkControl.mutate({ action, hostname })}
                onPriorityChange={(job, value) => {
                  modal.confirm({
                    title: '调整任务优先级？',
                    content: '同域名任务会按新优先级领取，不会影响其他域名的并发。',
                    okText: '确认调整',
                    cancelText: '返回',
                    onOk: () => priority.mutateAsync({ id: job.id, value })
                  })
                }}
                onContinue={(job) => itemControl.mutate({ id: job.id, action: 'continue' })}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] py-16">
            <Empty
              description={jobs.data?.length ? '没有符合筛选条件的任务' : '任务队列还是空的'}
            />
          </div>
        )}
      </AsyncState>
    </div>
  )
}

function JobFiltersBar(props: {
  value: JobFilters
  onChange: (filters: JobFilters) => void
}): React.JSX.Element {
  const update = (patch: Partial<JobFilters>): void => props.onChange({ ...props.value, ...patch })
  return (
    <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] mb-4 grid gap-3 p-3 sm:grid-cols-[minmax(12rem,1fr)_11rem_10rem_auto]">
      <Input
        allowClear
        prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
        placeholder="筛选域名、文档或任务 ID"
        value={props.value.query}
        onChange={(event) => update({ query: event.target.value })}
      />
      <input
        aria-label="批次日期"
        type="date"
        value={props.value.date}
        onChange={(event) => update({ date: event.target.value })}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ant-color-primary)] h-8 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-3 text-sm text-[var(--ant-color-text)]"
      />
      <Select<JobViewStatus | 'all'>
        aria-label="任务状态"
        value={props.value.status}
        options={statusOptions}
        onChange={(status) => update({ status })}
      />
      <Button onClick={() => props.onChange({ query: '', date: '', status: 'all' })}>
        清除筛选
      </Button>
    </div>
  )
}

function updateCachedJob(client: ReturnType<typeof useQueryClient>, incoming: LocalJob): void {
  client.setQueryData<LocalJob[]>(JOBS_KEY, (current = []) => {
    const found = current.some((job) => job.id === incoming.id)
    return found
      ? current.map((job) => (job.id === incoming.id ? incoming : job))
      : [incoming, ...current]
  })
}

function pendingActionKey(
  item: { isPending: boolean; variables?: { id: string; action: ItemAction } },
  bulk: {
    isPending: boolean
    variables?: { action: 'pause-all' | 'resume-all'; hostname?: string }
  },
  priority: { isPending: boolean; variables?: { id: string } }
): string | undefined {
  if (item.isPending && item.variables) return `${item.variables.action}:${item.variables.id}`
  if (bulk.isPending && bulk.variables) {
    return `${bulk.variables.action}:${bulk.variables.hostname ?? '*'}`
  }
  if (priority.isPending && priority.variables) return `priority:${priority.variables.id}`
  return undefined
}

const actionSuccess: Record<ItemAction, string> = {
  pause: '任务将在当前批次后暂停',
  resume: '任务已恢复',
  stop: '任务将在当前批次后结束并保留内容',
  cancel: '已提交取消请求',
  continue: '任务已从保存的检查点恢复'
}

const statusOptions: Array<{ value: JobViewStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'pending', label: '等待中' },
  { value: 'paused', label: '已暂停' },
  { value: 'stopped', label: '已结束' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' }
]
