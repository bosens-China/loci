import type { UseQueryResult } from '@tanstack/react-query'
import { Button, Card, Popconfirm, Progress, Space, Tag, Tooltip } from 'antd'
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { CloudLibrary, CloudSyncJob } from '@loci/shared'
import { AsyncState } from '@/components/AsyncState'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { useCurrentTime } from '@/hooks/use-current-time'
import { getAdminSyncPercent, isAdminJobActive } from '@/pages/admin/admin-state'
import { AdminJobActions } from '@/pages/admin/AdminJobActions'

interface AdminJobsPanelProps {
  query: UseQueryResult<CloudSyncJob[], Error>
  libraries: CloudLibrary[] | undefined
  onControl: (id: string, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
  onPriority: (id: string, priority: number) => void
  onDomainControl: (hostname: string | undefined, action: 'pause-all' | 'resume-all') => void
  pendingKey: string | undefined
}

/** Server 任务管理面板：按域名分组聚合、展示实时抓取速率、进度状态与控制操作。 */
export function AdminJobsPanel(props: AdminJobsPanelProps): React.JSX.Element {
  const now = useCurrentTime()
  const libraries = new Map((props.libraries ?? []).map((library) => [library.id, library]))
  const allJobs = props.query.data ?? []
  const groups = groupAdminJobs(allJobs, libraries)
  const globalActiveCount = allJobs.filter(isAdminJobActive).length
  const globalPausedCount = allJobs.filter((j) => j.paused || j.pauseRequested).length

  return (
    <div className="space-y-4">
      {/* 顶部全局操作栏 */}
      <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-[var(--ant-color-text)]">
            共 <span className="font-semibold">{allJobs.length}</span> 个同步记录 ·{' '}
            <span className="text-[var(--ant-color-primary)] font-semibold">
              {globalActiveCount}
            </span>{' '}
            个正在运行
          </div>
          <Space size={8}>
            {globalActiveCount > 0 && (
              <Popconfirm
                title="暂停全部 Server 活动任务？"
                okText="全部暂停"
                cancelText="返回"
                onConfirm={() => props.onDomainControl(undefined, 'pause-all')}
              >
                <Button icon={<PauseCircleOutlined />} loading={props.pendingKey === 'pause-all:*'}>
                  全部暂停
                </Button>
              </Popconfirm>
            )}
            {globalPausedCount > 0 && (
              <Popconfirm
                title="恢复全部 Server 未完结任务？"
                okText="全部恢复"
                cancelText="返回"
                onConfirm={() => props.onDomainControl(undefined, 'resume-all')}
              >
                <Button icon={<PlayCircleOutlined />} loading={props.pendingKey === 'resume-all:*'}>
                  全部恢复
                </Button>
              </Popconfirm>
            )}
            <Button
              icon={<ReloadOutlined />}
              loading={props.query.isFetching}
              onClick={() => void props.query.refetch()}
            >
              刷新任务
            </Button>
          </Space>
        </div>
      </Card>

      <AsyncState
        loading={props.query.isLoading}
        error={props.query.error}
        empty={props.query.data?.length === 0}
        emptyText="暂无 Server 同步任务"
        onRetry={() => void props.query.refetch()}
      >
        <div className="space-y-4">
          {groups.map((group) => {
            const groupActiveCount = group.jobs.filter(isAdminJobActive).length
            const groupPausedCount = group.jobs.filter((j) => j.paused || j.pauseRequested).length

            return (
              <Card
                key={group.hostname}
                styles={{ body: { padding: 0 } }}
                className="shadow-xs border-[var(--ant-color-border-secondary)] overflow-hidden"
                title={
                  <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-base font-semibold text-[var(--ant-color-text)]">
                        {group.hostname}
                      </span>
                      <Tag color="blue" className="m-0!">
                        {group.jobs.length} 个任务
                      </Tag>
                      {groupActiveCount > 0 && (
                        <Tag color="processing" className="m-0!">
                          {groupActiveCount} 运行中
                        </Tag>
                      )}
                    </div>
                    {(groupActiveCount > 0 || groupPausedCount > 0) && (
                      <Space size={6}>
                        {groupActiveCount > 0 && (
                          <Popconfirm
                            title={`暂停 ${group.hostname} 的全部活动任务？`}
                            okText="全部暂停"
                            cancelText="返回"
                            onConfirm={() => props.onDomainControl(group.hostname, 'pause-all')}
                          >
                            <Button
                              size="small"
                              loading={props.pendingKey === `pause-all:${group.hostname}`}
                            >
                              暂停此域名
                            </Button>
                          </Popconfirm>
                        )}
                        {groupPausedCount > 0 && (
                          <Popconfirm
                            title={`恢复 ${group.hostname} 的全部未完结任务？`}
                            okText="全部恢复"
                            cancelText="返回"
                            onConfirm={() => props.onDomainControl(group.hostname, 'resume-all')}
                          >
                            <Button
                              size="small"
                              loading={props.pendingKey === `resume-all:${group.hostname}`}
                            >
                              恢复此域名
                            </Button>
                          </Popconfirm>
                        )}
                      </Space>
                    )}
                  </div>
                }
              >
                <div className="divide-y divide-[var(--ant-color-border-secondary)]">
                  {group.jobs.map((job) => {
                    const library = libraries.get(job.libraryId)
                    const elapsed =
                      (job.finishedAt ? new Date(job.finishedAt).getTime() : now) -
                      new Date(job.createdAt).getTime()
                    return (
                      <article
                        key={job.id}
                        className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(14rem,1fr)_12rem_10rem_auto] lg:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm font-semibold truncate text-[var(--ant-color-text)]">
                              {library?.name ?? job.libraryId}
                            </strong>
                            <Tag color={statusColor(job.status)}>{statusLabel(job.status)}</Tag>
                          </div>
                          <div
                            className="mt-1 truncate font-mono text-xs text-[var(--ant-color-text-secondary)]"
                            title={job.id}
                          >
                            {job.id}
                          </div>
                          {job.error && (
                            <Tooltip title={job.error} placement="bottomLeft">
                              <div className="mt-1 truncate text-xs text-[var(--ant-color-error)]">
                                失败原因：{job.error}
                              </div>
                            </Tooltip>
                          )}
                        </div>
                        <JobProgressSection job={job} />
                        <div className="text-xs text-[var(--ant-color-text-secondary)] leading-relaxed">
                          <div>耗时 {formatDuration(elapsed)}</div>
                          <div>正文 {formatBytes(job.contentBytes)}</div>
                          {isAdminJobActive(job) && (
                            <div>
                              预计剩余 {formatDuration(estimateAdminRemaining(job, elapsed))}
                            </div>
                          )}
                          {job.remainingCount > 0 && <div>剩余 {job.remainingCount} 页</div>}
                          <div>{formatDateTime(job.createdAt)}</div>
                        </div>
                        <AdminJobActions
                          job={job}
                          pendingKey={props.pendingKey}
                          onControl={props.onControl}
                          onPriority={props.onPriority}
                        />
                      </article>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      </AsyncState>
    </div>
  )
}

function groupAdminJobs(
  jobs: CloudSyncJob[],
  libraries: ReadonlyMap<string, CloudLibrary>
): Array<{ hostname: string; jobs: CloudSyncJob[] }> {
  const groups = new Map<string, CloudSyncJob[]>()
  for (const job of jobs) {
    const hostname = job.hostname || libraries.get(job.libraryId)?.hostname || '未知域名'
    groups.set(hostname, [...(groups.get(hostname) ?? []), job])
  }
  return [...groups.entries()]
    .map(([hostname, items]) => ({ hostname, jobs: items }))
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
}

function estimateAdminRemaining(job: CloudSyncJob, elapsed: number): number | null {
  const processed = job.progress?.processed ?? 0
  if (processed <= 0 || job.remainingCount <= 0) return null
  return Math.round((elapsed / processed) * job.remainingCount)
}

function JobProgressSection({ job }: { job?: CloudSyncJob }): React.JSX.Element {
  if (!job) return <span className="text-xs text-[var(--ant-color-text-secondary)]">—</span>
  if (job.paused || job.pauseRequested) return <Tag color="warning">已暂停</Tag>
  if (job.partial) return <Tag color="warning">已结束，可继续</Tag>
  if (job.status === 'failed') {
    return (
      <div className="max-w-44">
        <Tag color="error">同步失败</Tag>
        <div
          className="mt-1 truncate text-xs text-[var(--ant-color-error)]"
          title={job.error ?? ''}
        >
          {job.error ?? '请检查 Server 日志'}
        </div>
      </div>
    )
  }
  if (job.status === 'canceled') return <Tag>已取消</Tag>
  if (job.status === 'canceling') return <Tag color="warning">正在取消</Tag>
  if (!job.progress) {
    return <Tag color={isAdminJobActive(job) ? 'processing' : undefined}>等待开始</Tag>
  }
  const { processed, queued, failed } = job.progress
  const active = isAdminJobActive(job)
  const status =
    job.status === 'completed_with_errors' ? 'exception' : active ? 'active' : 'success'
  return (
    <div className="w-40">
      <Progress percent={getAdminSyncPercent(job)} size="small" status={status} showInfo={false} />
      <div
        className={`text-xs ${failed ? 'text-[var(--ant-color-warning)]' : 'text-[var(--ant-color-text-secondary)]'}`}
      >
        {active
          ? `已处理 ${processed} · 待处理 ${queued}`
          : failed
            ? `完成 ${processed} · 失败 ${failed}`
            : `完成 ${processed} 页`}
      </div>
      {job.progress.node && (
        <div
          className="truncate text-xs text-[var(--ant-color-text-secondary)]"
          title={job.progress.node.url}
        >
          {job.progress.node.status} · {job.progress.node.title}
        </div>
      )}
    </div>
  )
}

function statusLabel(status: CloudSyncJob['status']): string {
  return (
    {
      queued: '等待中',
      running: '运行中',
      canceling: '取消中',
      canceled: '已取消',
      completed: '已完成',
      completed_with_errors: '部分失败',
      failed: '失败'
    } as const
  )[status]
}

function statusColor(status: CloudSyncJob['status']): string | undefined {
  if (['queued', 'running', 'canceling'].includes(status)) return 'processing'
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'completed_with_errors') return 'error'
  return undefined
}
