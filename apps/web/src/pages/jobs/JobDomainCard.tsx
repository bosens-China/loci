import { CaretRightOutlined, CloseOutlined, PauseOutlined, StopOutlined } from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { Button, Card, Progress, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { triggerLabel } from '@/utils/status-labels'
import {
  estimateRemainingMs,
  getJobProgressView,
  jobViewStatus,
  localJobElementId,
  type HostnameJobGroup
} from './job-state'

interface JobDomainCardProps {
  group: HostnameJobGroup
  now: number
  sourceNames: ReadonlyMap<string, string>
  pendingAction?: string
  onJobAction: (job: LocalJob, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
  onDomainAction: (hostname: string, action: 'pause-all' | 'resume-all') => void
  onPriorityChange: (job: LocalJob, priority: number) => void
  onContinue: (job: LocalJob) => void
  activeJobsBySource: ReadonlyMap<string, LocalJob>
  onViewActiveJob: (job: LocalJob) => void
}

/** 域名抓取卡片：展示共享队列概览与域名下各个子任务。 */
export function JobDomainCard(props: JobDomainCardProps): React.JSX.Element {
  const { group } = props
  const percent = group.queued
    ? Math.min(100, Math.round((group.processed / group.queued) * 100))
    : group.jobs.some((j) => j.status === 'completed')
      ? 100
      : 0

  return (
    <Card
      styles={{ body: { padding: 0 } }}
      className="shadow-xs overflow-hidden border-[var(--ant-color-border-secondary)]"
      title={
        <div className="flex flex-wrap items-center gap-3 py-1">
          <div className="flex items-center gap-2">
            <Typography.Text strong className="font-mono text-sm">
              {group.hostname}
            </Typography.Text>
            <Tag color="blue" className="m-0!">
              共享队列
            </Tag>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Tag className="m-0!">{group.jobs.length} 个任务</Tag>
            {group.active > 0 && (
              <Tag color="processing" className="m-0!">
                {group.active} 个运行中
              </Tag>
            )}
            {group.paused > 0 && (
              <Tag color="warning" className="m-0!">
                {group.paused} 个暂停
              </Tag>
            )}
            {group.failed > 0 && (
              <Tag color="error" className="m-0!">
                {group.failed} 个失败
              </Tag>
            )}
            <Typography.Text type="secondary" className="text-xs">
              累计抓取 {formatBytes(group.contentBytes)}
            </Typography.Text>
          </div>
        </div>
      }
      extra={
        <div className="flex items-center gap-4">
          <Tooltip title={`域名整体进度：已处理 ${group.processed}/${group.queued || '—'} 页`}>
            <Progress
              type="circle"
              size={40}
              percent={percent}
              format={(p) => <span className="text-[11px] font-semibold">{p}%</span>}
              status={
                percent === 100 && group.failed === 0
                  ? 'success'
                  : group.failed > 0 && group.active === 0
                    ? 'exception'
                    : group.active > 0
                      ? 'active'
                      : 'normal'
              }
              strokeWidth={6}
            />
          </Tooltip>
          {(group.active > 0 || group.paused > 0) && (
            <Space size={6}>
              {group.active > 0 && (
                <ConfirmedActionButton
                  title={`暂停 ${group.hostname} 的全部活动任务？`}
                  description="已经发出的页面请求会完成，后续批次将停止领取。"
                  label="全部暂停"
                  icon={<PauseOutlined />}
                  size="small"
                  loading={props.pendingAction === `pause-all:${group.hostname}`}
                  onConfirm={() => props.onDomainAction(group.hostname, 'pause-all')}
                />
              )}
              {group.paused > 0 && (
                <ConfirmedActionButton
                  title={`恢复 ${group.hostname} 的全部暂停任务？`}
                  description="任务将继续使用原任务 ID 和已保存的检查点。"
                  label="全部恢复"
                  icon={<CaretRightOutlined />}
                  size="small"
                  loading={props.pendingAction === `resume-all:${group.hostname}`}
                  onConfirm={() => props.onDomainAction(group.hostname, 'resume-all')}
                />
              )}
            </Space>
          )}
        </div>
      }
    >
      <div className="max-h-[36rem] divide-y divide-[var(--ant-color-border-secondary)] overflow-y-auto overscroll-contain">
        {group.jobs.map((job) => (
          <JobRow key={job.id} {...props} job={job} />
        ))}
      </div>
    </Card>
  )
}

function JobRow(props: JobDomainCardProps & { job: LocalJob }): React.JSX.Element {
  const { job } = props
  const status = jobViewStatus(job)
  const progress = job.result
  const progressView = getJobProgressView(job)
  const elapsed = job.startedAt
    ? (job.finishedAt ? new Date(job.finishedAt).getTime() : props.now) -
      new Date(job.startedAt).getTime()
    : null
  const active = job.status === 'pending' || job.status === 'running'
  const remaining = estimateRemainingMs(job, props.now)
  const currentJob = props.activeJobsBySource.get(job.sourceId)
  const retryableHistory = status === 'stopped' || status === 'failed' || status === 'cancelled'
  const activeReplacement = retryableHistory && currentJob?.id !== job.id ? currentJob : undefined

  return (
    <article
      id={localJobElementId(job.id)}
      className="scroll-m-4 px-4 py-3.5 transition-colors hover:bg-[var(--ant-color-fill-quaternary)] sm:px-5"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Typography.Text strong className="min-w-0 truncate text-sm">
              {props.sourceNames.get(job.sourceId) ?? '文档同步'}
            </Typography.Text>
            <JobStatus status={status} />
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--ant-color-text-secondary)]">
            <span className="max-w-64 shrink truncate font-mono" title={job.id}>
              {job.id}
            </span>
            <span>·</span>
            <span className="shrink-0">{triggerLabel(job.trigger)}</span>
            <span>·</span>
            <span className="shrink-0">{formatDateTime(job.scheduledAt)}</span>
            {job.priority !== 0 && (
              <>
                <span>·</span>
                <span className="shrink-0">优先级 {job.priority}</span>
              </>
            )}
          </div>

          {active ? (
            <div className="mt-3 max-w-3xl" aria-live="polite">
              <div className="mb-1 flex min-w-0 items-center justify-between gap-4 text-xs">
                <div className="flex min-w-0 items-center gap-2 text-[var(--ant-color-text)]">
                  {progressView.kind === 'indeterminate' && <Spin size="small" />}
                  <span className="truncate" title={progressView.current}>
                    {progressView.current}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-[var(--ant-color-text-secondary)]">
                  {progressView.kind === 'determinate'
                    ? `${progressView.processed}/${progressView.total} 页 · ${progressView.percent}%`
                    : '准备中'}
                </span>
              </div>
              {progressView.kind === 'determinate' ? (
                <Progress
                  percent={progressView.percent}
                  showInfo={false}
                  size="small"
                  status={job.status === 'running' ? 'active' : 'normal'}
                  className="m-0! block!"
                />
              ) : (
                <div className="h-1.5 rounded-full bg-[var(--ant-color-fill-secondary)]" />
              )}
              <div className="mt-1 text-xs text-[var(--ant-color-text-secondary)]">
                已抓取 {formatBytes(job.contentBytes)}
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--ant-color-text-secondary)]">
              <span>处理 {progress?.processed ?? 0} 页</span>
              <span>·</span>
              <span>{formatBytes(job.contentBytes)}</span>
              {elapsed !== null && (
                <>
                  <span>·</span>
                  <span>耗时 {formatDuration(elapsed)}</span>
                </>
              )}
              {job.remainingCount > 0 && (
                <>
                  <span>·</span>
                  <span>剩余检查点 {job.remainingCount} 页</span>
                </>
              )}
            </div>
          )}

          {(job.error || activeReplacement) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {job.error && (
                <div className="inline-flex items-center gap-1 rounded bg-[var(--ant-color-error-bg)] px-2 py-0.5 text-xs text-[var(--ant-color-error)]">
                  <span>失败原因：{job.error}</span>
                </div>
              )}
              {activeReplacement && (
                <div className="rounded bg-[var(--ant-color-info-bg)] px-2 py-0.5 text-xs text-[var(--ant-color-info)]">
                  已有新的同步任务正在运行
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {active && (
            <div className="flex items-center justify-end gap-3 whitespace-nowrap">
              <div className="flex items-center gap-1 text-xs">
                <Typography.Text type="secondary">预计剩余</Typography.Text>
                <Typography.Text strong>
                  {remaining === null ? '计算中' : formatDuration(remaining)}
                </Typography.Text>
              </div>
              <Select
                aria-label="任务优先级"
                size="small"
                value={job.priority}
                className="w-20"
                options={[
                  { value: 100, label: '高' },
                  { value: 0, label: '普通' },
                  { value: -50, label: '低' }
                ]}
                onChange={(value) => props.onPriorityChange(job, value)}
              />
            </div>
          )}

          <div className="flex justify-end">
            <JobActions
              {...props}
              job={job}
              status={status}
              activeReplacement={activeReplacement}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function JobActions(
  props: JobDomainCardProps & {
    job: LocalJob
    status: ReturnType<typeof jobViewStatus>
    activeReplacement?: LocalJob
  }
): React.JSX.Element {
  const { activeReplacement, job, status } = props
  const loading = (action: string): boolean => props.pendingAction === `${action}:${job.id}`
  if (status === 'stopped' || status === 'failed' || status === 'cancelled') {
    if (activeReplacement) {
      return (
        <Button
          type="link"
          size="small"
          icon={<CaretRightOutlined />}
          onClick={() => props.onViewActiveJob(activeReplacement)}
        >
          查看当前同步
        </Button>
      )
    }
    const continuation = status === 'stopped'
    return (
      <ConfirmedActionButton
        title={continuation ? '继续这个未完整任务？' : '重新提交这个任务？'}
        description={
          continuation
            ? '将复用原任务 ID，并从保存的剩余 URL 继续。'
            : '将复用原任务并重新执行；已有文档内容会保留到成功提交。'
        }
        label={continuation ? '继续' : '重试'}
        icon={<CaretRightOutlined />}
        size="small"
        loading={loading('continue')}
        onConfirm={() => props.onContinue(job)}
      />
    )
  }
  if (status === 'paused') {
    return (
      <ConfirmedActionButton
        title="恢复这个任务？"
        label="恢复"
        icon={<CaretRightOutlined />}
        size="small"
        loading={loading('resume')}
        onConfirm={() => props.onJobAction(job, 'resume')}
      />
    )
  }
  if (job.status !== 'pending' && job.status !== 'running') return <></>
  return (
    <Space size={4}>
      <ConfirmedActionButton
        title="暂停这个任务？"
        description="当前页面请求完成后暂停，已保存的检查点会保留。"
        label="暂停"
        icon={<PauseOutlined />}
        size="small"
        loading={loading('pause')}
        disabled={status === 'pausing' || status === 'stopping'}
        onConfirm={() => props.onJobAction(job, 'pause')}
      />
      <ConfirmedActionButton
        title="结束并保留已抓取内容？"
        description="已完成内容会立即提交，剩余页面可在以后继续。"
        label="结束"
        icon={<StopOutlined />}
        size="small"
        loading={loading('stop')}
        disabled={status === 'stopping'}
        onConfirm={() => props.onJobAction(job, 'stop')}
      />
      <ConfirmedActionButton
        danger
        title="取消并丢弃本次抓取？"
        description="本次尚未提交的内容和检查点会被删除。"
        label="取消"
        icon={<CloseOutlined />}
        size="small"
        loading={loading('cancel')}
        onConfirm={() => props.onJobAction(job, 'cancel')}
      />
    </Space>
  )
}

function JobStatus({ status }: { status: ReturnType<typeof jobViewStatus> }): React.JSX.Element {
  const view = statusTags[status]
  return (
    <Tag color={view.color} className="m-0!">
      {view.label}
    </Tag>
  )
}

const statusTags: Record<ReturnType<typeof jobViewStatus>, { label: string; color?: string }> = {
  pending: { label: '等待中', color: 'warning' },
  running: { label: '运行中', color: 'processing' },
  pausing: { label: '暂停中', color: 'warning' },
  paused: { label: '已暂停', color: 'default' },
  stopping: { label: '结束中', color: 'warning' },
  stopped: { label: '已结束', color: 'default' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' }
}
