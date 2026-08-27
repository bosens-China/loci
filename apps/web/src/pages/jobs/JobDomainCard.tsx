import { CaretRightOutlined, CloseOutlined, PauseOutlined, StopOutlined } from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { Progress, Select, Tooltip } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { triggerLabel } from '@/utils/status-labels'
import { estimateRemainingMs, jobViewStatus, type HostnameJobGroup } from './job-state'

interface JobDomainCardProps {
  group: HostnameJobGroup
  now: number
  sourceNames: ReadonlyMap<string, string>
  pendingAction?: string
  onJobAction: (job: LocalJob, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
  onDomainAction: (hostname: string, action: 'pause-all' | 'resume-all') => void
  onPriorityChange: (job: LocalJob, priority: number) => void
  onContinue: (job: LocalJob) => void
}

export function JobDomainCard(props: JobDomainCardProps): React.JSX.Element {
  const { group } = props
  const percent = group.queued
    ? Math.min(100, Math.round((group.processed / group.queued) * 100))
    : 0
  return (
    <section className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] overflow-hidden">
      <header className="border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--ant-color-primary)]" />
              <h2 className="m-0 truncate font-mono text-sm font-700 text-[var(--ant-color-text)]">
                {group.hostname}
              </h2>
              <span className="rounded-full bg-[var(--ant-color-fill-secondary)] px-2 py-0.5 text-[10px] font-700 tracking-wide text-[var(--ant-color-text-secondary)] uppercase">
                共享队列
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-[var(--ant-color-text-secondary)] sm:flex sm:flex-wrap">
              <span>{group.jobs.length} 个任务</span>
              <span>{group.active} 个活动</span>
              <span>{group.paused} 个暂停</span>
              <span>{formatBytes(group.contentBytes)} 已抓取</span>
            </div>
          </div>
          <div className="w-full lg:w-64">
            <Progress percent={percent} size="small" showInfo={false} />
            <div className="mt-0.5 text-xs text-[var(--ant-color-text-secondary)]">
              已处理 {group.processed}/{group.queued || '—'} · 失败 {group.failed}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <ConfirmedActionButton
              title={`暂停 ${group.hostname} 的全部活动任务？`}
              description="已经发出的页面请求会完成，后续批次将停止领取。"
              label="全部暂停"
              icon={<PauseOutlined />}
              loading={props.pendingAction === `pause-all:${group.hostname}`}
              onConfirm={() => props.onDomainAction(group.hostname, 'pause-all')}
            />
            <ConfirmedActionButton
              title={`恢复 ${group.hostname} 的全部暂停任务？`}
              description="任务将继续使用原任务 ID 和已保存的检查点。"
              label="全部恢复"
              icon={<CaretRightOutlined />}
              loading={props.pendingAction === `resume-all:${group.hostname}`}
              onConfirm={() => props.onDomainAction(group.hostname, 'resume-all')}
            />
          </div>
        </div>
      </header>
      <div className="max-h-112 divide-y divide-[var(--ant-color-border-secondary)] overflow-y-auto">
        {group.jobs.map((job) => (
          <JobRow key={job.id} {...props} job={job} />
        ))}
      </div>
    </section>
  )
}

function JobRow(props: JobDomainCardProps & { job: LocalJob }): React.JSX.Element {
  const { job } = props
  const status = jobViewStatus(job)
  const progress = job.result
  const total = Math.max(progress?.queued ?? 0, progress?.processed ?? 0)
  const percent = total ? Math.min(100, Math.round(((progress?.processed ?? 0) / total) * 100)) : 0
  const elapsed = job.startedAt
    ? (job.finishedAt ? new Date(job.finishedAt).getTime() : props.now) -
      new Date(job.startedAt).getTime()
    : null
  const active = job.status === 'pending' || job.status === 'running'
  return (
    <article className="px-4 py-4 transition-colors hover:bg-[var(--ant-color-fill-quaternary)] sm:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(12rem,1fr)_9rem_11rem_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-650 text-[var(--ant-color-text)]">
              {props.sourceNames.get(job.sourceId) ?? '文档同步'}
            </span>
            <JobStatus status={status} />
            {job.priority !== 0 && (
              <span className="text-[10px] font-700 text-[var(--ant-color-primary)]">
                优先级 {job.priority}
              </span>
            )}
          </div>
          <div
            className="mt-1 truncate font-mono text-[11px] text-[var(--ant-color-text-secondary)]"
            title={job.id}
          >
            {job.id}
          </div>
          {job.error && (
            <Tooltip title={job.error} placement="bottomLeft">
              <div className="mt-1.5 truncate text-xs text-[var(--ant-color-error)]">
                失败原因：{job.error}
              </div>
            </Tooltip>
          )}
        </div>
        <div className="min-w-0">
          <Progress
            percent={percent}
            size="small"
            showInfo={false}
            status={job.status === 'failed' ? 'exception' : active ? 'active' : 'success'}
          />
          <div className="mt-0.5 truncate text-xs text-[var(--ant-color-text-secondary)]">
            已处理 {progress?.processed ?? 0}/{total || '—'} · {formatBytes(job.contentBytes)}
          </div>
          {progress?.node && (
            <div
              className="mt-0.5 truncate text-[11px] text-[var(--ant-color-text-secondary)]"
              title={progress.node.url}
            >
              {progress.node.title}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs lg:block">
          <Metric label="耗时" value={formatDuration(elapsed)} />
          <Metric
            label="预计剩余"
            value={active ? formatDuration(estimateRemainingMs(job)) : '—'}
          />
        </div>
        <div className="text-xs text-[var(--ant-color-text-secondary)]">
          <div>
            {triggerLabel(job.trigger)} · {formatDateTime(job.scheduledAt)}
          </div>
          <div className="mt-1">剩余检查点 {job.remainingCount} 页</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {active && (
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
          )}
          <JobActions {...props} job={job} status={status} />
        </div>
      </div>
    </article>
  )
}

function JobActions(
  props: JobDomainCardProps & { job: LocalJob; status: ReturnType<typeof jobViewStatus> }
): React.JSX.Element {
  const { job, status } = props
  const loading = (action: string): boolean => props.pendingAction === `${action}:${job.id}`
  if (status === 'stopped' || status === 'failed' || status === 'cancelled') {
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
        loading={loading('resume')}
        onConfirm={() => props.onJobAction(job, 'resume')}
      />
    )
  }
  if (job.status !== 'pending' && job.status !== 'running') return <></>
  return (
    <>
      <ConfirmedActionButton
        title="暂停这个任务？"
        description="当前页面请求完成后暂停，已保存的检查点会保留。"
        label="暂停"
        icon={<PauseOutlined />}
        loading={loading('pause')}
        disabled={status === 'pausing' || status === 'stopping'}
        onConfirm={() => props.onJobAction(job, 'pause')}
      />
      <ConfirmedActionButton
        title="结束并保留已抓取内容？"
        description="已完成内容会立即提交，剩余页面可在以后继续。"
        label="结束"
        icon={<StopOutlined />}
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
        loading={loading('cancel')}
        onConfirm={() => props.onJobAction(job, 'cancel')}
      />
    </>
  )
}

function JobStatus({ status }: { status: ReturnType<typeof jobViewStatus> }): React.JSX.Element {
  const view = statusViews[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-650 ${view.className}`}>
      {view.label}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="mb-1">
      <span className="text-[var(--ant-color-text-secondary)]">{label}</span>
      <span className="ml-1 font-600 text-[var(--ant-color-text)]">{value}</span>
    </div>
  )
}

const statusViews: Record<
  ReturnType<typeof jobViewStatus>,
  { label: string; className: string }
> = {
  pending: {
    label: '等待中',
    className: 'bg-[var(--ant-color-warning-bg)] text-[var(--ant-color-warning)]'
  },
  running: {
    label: '运行中',
    className: 'bg-[var(--ant-color-info-bg)] text-[var(--ant-color-primary)]'
  },
  pausing: {
    label: '暂停中',
    className: 'bg-[var(--ant-color-warning-bg)] text-[var(--ant-color-warning)]'
  },
  paused: {
    label: '已暂停',
    className: 'bg-[var(--ant-color-fill-tertiary)] text-[var(--ant-color-text-secondary)]'
  },
  stopping: {
    label: '结束中',
    className: 'bg-[var(--ant-color-warning-bg)] text-[var(--ant-color-warning)]'
  },
  stopped: {
    label: '已结束',
    className: 'bg-[var(--ant-color-fill-tertiary)] text-[var(--ant-color-text-secondary)]'
  },
  completed: {
    label: '已完成',
    className: 'bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)]'
  },
  failed: {
    label: '失败',
    className: 'bg-[var(--ant-color-error-bg)] text-[var(--ant-color-error)]'
  },
  cancelled: {
    label: '已取消',
    className: 'bg-[var(--ant-color-fill-tertiary)] text-[var(--ant-color-text-secondary)]'
  }
}
