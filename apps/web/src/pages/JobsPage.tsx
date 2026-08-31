import { useEffect, useMemo, useState } from 'react'
import {
  CaretRightOutlined,
  CheckCircleOutlined,
  PauseOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, DatePicker, Empty, Input, Progress, Select, Tabs, Tag } from 'antd'
import dayjs from 'dayjs'
import {
  cancelJob,
  controlAllJobs,
  controlJob,
  JOBS_QUERY_KEY,
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
  getLatestActiveJobsBySource,
  groupJobsByHostname,
  localJobElementId,
  type JobFilters,
  type JobViewStatus,
  upsertLocalJob
} from '@/pages/jobs/job-state'

type ItemAction = JobControlAction | 'cancel' | 'continue'

export function JobsPage(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [filters, setFilters] = useState<JobFilters>({ query: '', date: '', status: 'all' })
  const [pendingFocusJobId, setPendingFocusJobId] = useState<string>()
  const jobs = useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: listJobs
  })
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const hasActiveJobs = (jobs.data ?? []).some(
    (job) => job.status === 'pending' || job.status === 'running'
  )
  const now = useCurrentTime(hasActiveJobs)
  const sourceNames = useMemo(
    () => new Map((sources.data ?? []).map((source) => [source.id, source.name])),
    [sources.data]
  )
  const groups = useMemo(
    () => groupJobsByHostname(filterJobs(jobs.data ?? [], sourceNames, filters)),
    [filters, jobs.data, sourceNames]
  )
  const activeJobsBySource = useMemo(
    () => getLatestActiveJobsBySource(jobs.data ?? []),
    [jobs.data]
  )

  useEffect(() => {
    if (!pendingFocusJobId) return
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(localJobElementId(pendingFocusJobId))
      if (!element) return
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPendingFocusJobId(undefined)
    })
    return () => cancelAnimationFrame(frame)
  }, [groups, pendingFocusJobId])

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
      void client.invalidateQueries({ queryKey: JOBS_QUERY_KEY })
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

  const totalCount = jobs.data?.length ?? 0
  const activeCount =
    jobs.data?.filter((j) => ['pending', 'running'].includes(j.status)).length ?? 0
  const runningCount = jobs.data?.filter((j) => j.status === 'running').length ?? 0
  const pausedCount =
    jobs.data?.filter((j) => j.status === 'pending' && Boolean(j.paused)).length ?? 0
  const completedCount = jobs.data?.filter((j) => j.status === 'completed').length ?? 0
  const failedCount = jobs.data?.filter((j) => j.status === 'failed').length ?? 0
  const overallPercent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="任务中心"
        description="按域名共享抓取队列与限速；不同域名并发执行，关闭浏览器后台仍持续推进。"
      />

      <Card size="small" className="mb-4 shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Progress
              type="circle"
              size={52}
              percent={overallPercent}
              format={(p) => <span className="text-xs font-semibold">{p}%</span>}
              status={
                overallPercent === 100 && failedCount === 0
                  ? 'success'
                  : failedCount > 0 && activeCount === 0
                    ? 'exception'
                    : runningCount > 0
                      ? 'active'
                      : 'normal'
              }
              strokeWidth={6}
            />
            <div>
              <div className="text-sm font-semibold">任务整体完成度 {overallPercent}%</div>
              <div className="mt-0.5 text-xs text-[var(--ant-color-text-secondary)]">
                共 {totalCount} 个任务 · {runningCount} 运行中 · {pausedCount} 已暂停 ·{' '}
                {completedCount} 已完成 · {failedCount} 失败
              </div>
            </div>
          </div>

          {/* 右侧操作栏：仅在有可操作任务时按需显示对应按钮，全部完成时展示完成徽标 */}
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
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
            )}
            {pausedCount > 0 && (
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
            )}
            {totalCount > 0 && activeCount === 0 && pausedCount === 0 && (
              <Tag
                color="success"
                icon={<CheckCircleOutlined />}
                className="m-0! px-2.5 py-1 text-xs"
              >
                全部任务已就绪
              </Tag>
            )}
          </div>
        </div>
      </Card>

      <Tabs
        activeKey={filters.status}
        onChange={(status) =>
          setFilters((current) => ({ ...current, status: status as JobViewStatus | 'all' }))
        }
        items={[
          { key: 'all', label: `全部 (${totalCount})` },
          { key: 'running', label: `运行中 (${runningCount})` },
          { key: 'pending', label: '等待中' },
          { key: 'paused', label: `已暂停 (${pausedCount})` },
          { key: 'completed', label: `已完成 (${completedCount})` },
          { key: 'failed', label: `失败 (${failedCount})` }
        ]}
        className="mb-3"
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
                activeJobsBySource={activeJobsBySource}
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
                onViewActiveJob={(job) => {
                  setPendingFocusJobId(job.id)
                  setFilters({ query: '', date: '', status: 'all' })
                }}
              />
            ))}
          </div>
        ) : (
          <Card className="py-16">
            <Empty
              description={jobs.data?.length ? '没有符合筛选条件的任务' : '任务队列还是空的'}
            />
          </Card>
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
    <Card size="small" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_12rem_10rem_auto]">
        <Input
          allowClear
          prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
          placeholder="筛选域名、文档或任务 ID"
          value={props.value.query}
          onChange={(event) => update({ query: event.target.value })}
        />
        <DatePicker
          placeholder="按日期筛选"
          value={props.value.date ? dayjs(props.value.date) : null}
          onChange={(_, dateStr) => update({ date: typeof dateStr === 'string' ? dateStr : '' })}
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
    </Card>
  )
}

function updateCachedJob(client: ReturnType<typeof useQueryClient>, incoming: LocalJob): void {
  client.setQueryData<LocalJob[]>(JOBS_QUERY_KEY, (current = []) =>
    upsertLocalJob(current, incoming)
  )
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
