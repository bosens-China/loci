import { CaretRightOutlined, CloseOutlined, PauseOutlined, StopOutlined } from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { Card, Progress, Select, Space, Tag, Tooltip, Typography } from 'antd'
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
      <div className="divide-y divide-[var(--ant-color-border-secondary)]">
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
  const total = Math.max(progress?.queued ?? 0, progress?.processed ?? 0)
  const percent = total ? Math.min(100, Math.round(((progress?.processed ?? 0) / total) * 100)) : 0
  const elapsed = job.startedAt
    ? (job.finishedAt ? new Date(job.finishedAt).getTime() : props.now) -
      new Date(job.startedAt).getTime()
    : null
  const active = job.status === 'pending' || job.status === 'running'

  return (
    <article className="px-4 py-3.5 transition-colors hover:bg-[var(--ant-color-fill-quaternary)] sm:px-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* 左侧主要信息 + 标题下方进度条 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Typography.Text strong className="truncate text-sm">
              {props.sourceNames.get(job.sourceId) ?? '文档同步'}
            </Typography.Text>
            <JobStatus status={status} />
            {job.priority !== 0 && (
              <Tag color="blue" className="text-xs">
                优先级 {job.priority}
              </Tag>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
            <span className="font-mono" title={job.id}>
              {job.id}
            </span>
            <span>·</span>
            <span>{triggerLabel(job.trigger)}</span>
            <span>·</span>
            <span>{formatDateTime(job.scheduledAt)}</span>
          </div>

          {/* 进度条仅在标题下方紧凑展示，避免割裂页面 */}
          {active ? (
            <div className="mt-2.5 max-w-lg">
              <Progress
                percent={percent}
                size="small"
                status={job.status === 'running' ? 'active' : 'normal'}
                className="m-0!"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
                <span>
                  已处理 {progress?.processed ?? 0}/{total || '—'} 页 ({percent}%)
                </span>
                <span>·</span>
                <span>已抓取 {formatBytes(job.contentBytes)}</span>
                {progress?.node?.title && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-xs text-[var(--ant-color-text)]">
                      当前: {progress.node.title}
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
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

          {job.error && (
            <div className="mt-2 inline-flex items-center gap-1 rounded bg-[var(--ant-color-error-bg)] px-2 py-0.5 text-xs text-[var(--ant-color-error)]">
              <span>失败原因：{job.error}</span>
            </div>
          )}
        </div>

        {/* 右侧耗时指标与操作按钮区 */}
        <div className="flex shrink-0 flex-wrap items-center gap-4 lg:self-center">
          {active && (
            <div className="text-right text-xs">
              <Typography.Text type="secondary" className="block">
                预计剩余
              </Typography.Text>
              <Typography.Text strong className="block">
                {formatDuration(estimateRemainingMs(job))}
              </Typography.Text>
            </div>
          )}

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
