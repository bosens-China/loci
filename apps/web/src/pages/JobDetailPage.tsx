import { useEffect, useMemo, useState } from 'react'
import type { LocalJob } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { App, Card, Empty } from 'antd'
import {
  cancelJob,
  controlAllJobs,
  controlJob,
  enqueueSourceSync,
  listJobs,
  setJobPriority,
  JOBS_QUERY_KEY,
  type JobControlAction
} from '@/api/jobs'
import { getSettings, listHostnameCrawlPolicies } from '@/api/settings'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { useCurrentTime } from '@/hooks/use-current-time'
import { ActiveJobItem } from './jobs/ActiveJobItem'
import { CompletedJobItem } from './jobs/CompletedJobItem'
import { FailedJobItem } from './jobs/FailedJobItem'
import { JobConcurrencyModal } from './jobs/JobConcurrencyModal'
import { JobDomainHeader } from './jobs/JobDomainHeader'
import { JobFiltersToolbar } from './jobs/JobFiltersToolbar'
import {
  calculateDomainConcurrency,
  filterJobs,
  groupJobsByHostname,
  isActiveJob,
  isFailedJob,
  jobViewStatus,
  upsertLocalJob,
  type JobFilters
} from './jobs/job-state'

type ItemAction = 'pause' | 'resume' | 'stop' | 'cancel' | 'continue'
const EMPTY_JOBS: LocalJob[] = []

/** 二级独立路由页面：域名任务详情页（/jobs/$hostname） */
export function JobDetailPage(): React.JSX.Element {
  const { hostname } = useParams({ strict: false }) as { hostname?: string }
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [filters, setFilters] = useState<JobFilters>({
    status: 'all',
    query: '',
    date: ''
  })
  const [pendingFocusJobId, setPendingFocusJobId] = useState<string | null>(null)

  const jobs = useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: listJobs,
    refetchInterval: 1500
  })

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: listSources
  })

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings
  })

  const policies = useQuery({
    queryKey: ['settings', 'hostname-policies'],
    queryFn: listHostnameCrawlPolicies
  })

  const safeHostname = decodeURIComponent(hostname || '')
  const sourcesMap = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.id, s])),
    [sources.data]
  )
  const sourceNames = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.id, s.name])),
    [sources.data]
  )

  const policy = (policies.data ?? []).find((p) => p.hostname === safeHostname)
  const allJobs = jobs.data ?? EMPTY_JOBS
  const domainJobs = useMemo(
    () => allJobs.filter((j) => j.hostname === safeHostname),
    [allJobs, safeHostname]
  )
  const groups = useMemo(() => groupJobsByHostname(allJobs), [allJobs])
  const currentGroup = useMemo(
    () => groups.find((g) => g.hostname === safeHostname),
    [groups, safeHostname]
  )

  const activeJobsBySource = useMemo(() => {
    const map = new Map<string, LocalJob>()
    for (const job of allJobs) {
      if (['pending', 'running'].includes(job.status)) {
        map.set(job.sourceId, job)
      }
    }
    return map
  }, [allJobs])

  const defaultHttpConcurrency = settings.data?.httpConcurrency ?? 9
  const defaultBrowserConcurrency = settings.data?.browserConcurrency ?? 5

  const hasBrowserJobs = domainJobs.some((job) => sourcesMap.get(job.sourceId)?.mode === 'browser')
  const configuredLimit = hasBrowserJobs
    ? (policy?.browserConcurrency ?? defaultBrowserConcurrency)
    : (policy?.httpConcurrency ?? defaultHttpConcurrency)

  const activeJobs = domainJobs.filter(isActiveJob)
  const concurrencySummary = calculateDomainConcurrency(activeJobs, configuredLimit)

  const activeCount = domainJobs.filter(isActiveJob).length
  const now = useCurrentTime(activeCount > 0)
  const runningCount = domainJobs.filter((j) => j.status === 'running').length
  const pausedCount = domainJobs.filter((j) => j.status === 'pending' && Boolean(j.paused)).length
  const completedCount = domainJobs.filter((j) => jobViewStatus(j) === 'completed').length
  const failedCount = domainJobs.filter(isFailedJob).length

  const filteredJobs = useMemo(
    () => filterJobs(domainJobs, sourceNames, filters),
    [domainJobs, filters, sourceNames]
  )

  const itemControl = useMutation({
    mutationFn: async ({
      id,
      action,
      sourceId
    }: {
      id: string
      action: ItemAction
      sourceId?: string
    }) => {
      if (action === 'cancel') return cancelJob(id)
      if (action === 'continue') {
        if (!sourceId) throw new Error('缺少文档来源 ID')
        await enqueueSourceSync(sourceId)
        return null
      }
      return controlJob(id, action as JobControlAction)
    },
    onSuccess: (job, { action }) => {
      if (job) updateCachedJob(client, job)
      else void jobs.refetch()
      void message.success(actionSuccess[action] ?? '操作已提交')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const bulkControl = useMutation({
    mutationFn: ({ action, hostname }: { action: 'pause-all' | 'resume-all'; hostname?: string }) =>
      controlAllJobs(action, hostname),
    onSuccess: (result, { action, hostname }) => {
      void jobs.refetch()
      void message.success(
        action === 'pause-all'
          ? `已下发暂停指令（${hostname ? `${hostname} 域名` : '全部活动任务'}，影响 ${result.changed} 个任务）`
          : `已下发恢复指令（${hostname ? `${hostname} 域名` : '全部暂停任务'}，影响 ${result.changed} 个任务）`
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

  useEffect(() => {
    if (!pendingFocusJobId) return
    const timer = setTimeout(() => {
      const el = document.getElementById(`local-job-${pendingFocusJobId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setPendingFocusJobId(null)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [pendingFocusJobId])

  const renderedElements = useMemo(() => {
    const activeList: React.JSX.Element[] = []
    const failedList: React.JSX.Element[] = []
    const completedList: React.JSX.Element[] = []

    for (const job of filteredJobs) {
      const isActive = isActiveJob(job)
      const isFailed = isFailedJob(job)
      const source = sourcesMap.get(job.sourceId)

      if (isActive) {
        const allocated = concurrencySummary.allocations.get(job.id) ?? 0
        activeList.push(
          <ActiveJobItem
            key={job.id}
            job={job}
            source={source}
            policy={policy}
            defaultHttpConcurrency={defaultHttpConcurrency}
            defaultBrowserConcurrency={defaultBrowserConcurrency}
            allocatedConcurrency={allocated}
            now={now}
            sourceNames={sourceNames}
            pendingAction={pendingAction}
            onJobAction={(j, act) =>
              itemControl.mutate({ id: j.id, action: act, sourceId: j.sourceId })
            }
            onPriorityChange={(j, val) => {
              modal.confirm({
                title: '调整任务优先级？',
                content: '同域名任务会按新优先级领取，不会影响其他域名的并发。',
                okText: '确认调整',
                cancelText: '返回',
                onOk: () => priority.mutateAsync({ id: j.id, value: val })
              })
            }}
            onOpenConcurrency={() => setModalOpen(true)}
          />
        )
      } else if (isFailed) {
        const currentActive = activeJobsBySource.get(job.sourceId)
        failedList.push(
          <FailedJobItem
            key={job.id}
            job={job}
            sourceNames={sourceNames}
            pendingAction={pendingAction}
            activeReplacement={currentActive?.id !== job.id ? currentActive : undefined}
            onContinue={(j) =>
              itemControl.mutate({ id: j.id, action: 'continue', sourceId: j.sourceId })
            }
            onViewActiveJob={(j) => {
              setPendingFocusJobId(j.id)
              setFilters({ query: '', date: '', status: 'all' })
            }}
          />
        )
      } else {
        completedList.push(
          <CompletedJobItem
            key={job.id}
            job={job}
            sourceNames={sourceNames}
            pendingAction={pendingAction}
            onContinue={(j) =>
              itemControl.mutate({ id: j.id, action: 'continue', sourceId: j.sourceId })
            }
            onJobAction={(j, act) =>
              itemControl.mutate({ id: j.id, action: act, sourceId: j.sourceId })
            }
          />
        )
      }
    }

    return [...activeList, ...failedList, ...completedList]
  }, [
    activeJobsBySource,
    concurrencySummary.allocations,
    defaultBrowserConcurrency,
    defaultHttpConcurrency,
    filteredJobs,
    itemControl,
    modal,
    now,
    pendingAction,
    policy,
    priority,
    sourceNames,
    sourcesMap
  ])

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-4">
      <AsyncState
        loading={jobs.isLoading || sources.isLoading}
        error={jobs.error ?? sources.error}
        onRetry={() => void Promise.all([jobs.refetch(), sources.refetch()])}
      >
        <JobDomainHeader
          hostname={safeHostname}
          totalCount={domainJobs.length}
          activeCount={activeCount}
          pausedCount={pausedCount}
          failedCount={failedCount}
          processed={currentGroup?.processed ?? 0}
          contentBytes={currentGroup?.contentBytes ?? 0}
          configuredLimit={configuredLimit}
          concurrency={concurrencySummary}
          pendingAction={pendingAction}
          onBack={() => void navigate({ to: '/jobs' })}
          onOpenConcurrency={() => setModalOpen(true)}
          onPause={() => bulkControl.mutate({ action: 'pause-all', hostname: safeHostname })}
          onResume={() => bulkControl.mutate({ action: 'resume-all', hostname: safeHostname })}
        />

        {/* 任务过滤工具栏 */}
        <JobFiltersToolbar
          filters={filters}
          totalCount={domainJobs.length}
          runningCount={runningCount}
          pausedCount={pausedCount}
          completedCount={completedCount}
          failedCount={failedCount}
          onChange={setFilters}
        />

        {/* 纯粹平铺的任务列表（无任何嵌套折叠） */}
        {renderedElements.length > 0 ? (
          <div className="space-y-3">{renderedElements}</div>
        ) : (
          <Card className="py-16">
            <Empty
              description={domainJobs.length ? '没有符合筛选条件的任务' : '该域名下暂无任务'}
            />
          </Card>
        )}

        {/* 并发限速弹窗 */}
        {modalOpen && (
          <JobConcurrencyModal
            open
            hostname={safeHostname}
            initialMode={hasBrowserJobs ? 'browser' : 'http'}
            onClose={() => setModalOpen(false)}
          />
        )}
      </AsyncState>
    </div>
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
  resume: '任务已恢复执行',
  stop: '任务将在当前批次后结束并保留已抓取内容',
  cancel: '已提交取消请求',
  continue: '任务已从检查点恢复继续执行'
}
