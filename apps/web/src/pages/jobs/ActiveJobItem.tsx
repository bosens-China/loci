import { useState } from 'react'
import {
  CloseOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HourglassOutlined,
  PauseOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UpOutlined
} from '@ant-design/icons'
import type { DocumentSource, HostnameCrawlPolicy, LocalJob } from '@loci/shared'
import { Badge, Button, Progress, Select, Tag, Tooltip, Typography } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { triggerLabel } from '@/utils/status-labels'
import {
  estimateRemainingMs,
  getJobProgressView,
  jobViewStatus,
  localJobElementId
} from './job-state'

interface ActiveJobItemProps {
  job: LocalJob
  source?: DocumentSource
  policy?: HostnameCrawlPolicy
  defaultHttpConcurrency: number
  defaultBrowserConcurrency: number
  allocatedConcurrency: number
  relatedFailures?: LocalJob[]
  now: number
  sourceNames: ReadonlyMap<string, string>
  pendingAction?: string
  onJobAction: (job: LocalJob, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
  onPriorityChange: (job: LocalJob, priority: number) => void
  onOpenConcurrency: (mode: 'http' | 'browser') => void
}

/** 运行中 / 活跃任务聚焦卡片（支持内嵌关联历史失败记录聚合与标准控件尺寸） */
export function ActiveJobItem(props: ActiveJobItemProps): React.JSX.Element {
  const {
    job,
    source,
    policy,
    defaultHttpConcurrency,
    defaultBrowserConcurrency,
    allocatedConcurrency,
    relatedFailures = []
  } = props
  const [showFailures, setShowFailures] = useState(false)
  const status = jobViewStatus(job)
  const progressView = getJobProgressView(job)
  const remaining = estimateRemainingMs(job, props.now)
  const elapsed = job.startedAt ? Math.max(0, props.now - new Date(job.startedAt).getTime()) : null
  const loading = (action: string): boolean => props.pendingAction === `${action}:${job.id}`

  const isBrowserMode = source?.mode === 'browser'
  const isGithub = source?.kind === 'github'

  const effectiveLimit = isBrowserMode
    ? (policy?.browserConcurrency ?? defaultBrowserConcurrency)
    : (policy?.httpConcurrency ?? defaultHttpConcurrency)

  return (
    <article
      id={localJobElementId(job.id)}
      className="scroll-m-4 rounded-lg border border-[var(--ant-color-primary-border)] bg-[var(--ant-color-primary-bg)]/20 p-4 transition-all hover:bg-[var(--ant-color-primary-bg)]/30"
    >
      {/* 头部：标题、抓取模式 Tag、状态徽标、动态并发分配 Tag 与预计剩余 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge status="processing" />
          <Typography.Text strong className="truncate text-base text-[var(--ant-color-text)]">
            {props.sourceNames.get(job.sourceId) ?? '文档同步'}
          </Typography.Text>

          {/* 抓取模式 Tag */}
          {isGithub ? (
            <Tag color="geekblue" className="m-0!">
              GitHub 仓库
            </Tag>
          ) : isBrowserMode ? (
            <Tag color="purple" icon={<ThunderboltOutlined />} className="m-0!">
              无头浏览器渲染
            </Tag>
          ) : (
            <Tag color="cyan" icon={<GlobalOutlined />} className="m-0!">
              HTTP 抓取
            </Tag>
          )}

          <span className="rounded bg-[var(--ant-color-primary-bg)] px-2.5 py-1 text-sm text-[var(--ant-color-primary)] font-medium">
            {statusLabels[status] ?? '运行中'}
          </span>
          <span className="text-sm text-[var(--ant-color-text-secondary)]">
            · {triggerLabel(job.trigger)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* 并发 Tag：显示按优先级动态分配到的并发数，点击直接呼出对应的并发调节弹窗 */}
          <Tooltip
            title={
              allocatedConcurrency > 0
                ? `当前任务分配并发: ${allocatedConcurrency} (域名上限: ${effectiveLimit})。点击调整限速策略。`
                : `并发配额已被前序/高优先级任务占满，当前排队等待中。点击调整限速策略。`
            }
          >
            {allocatedConcurrency > 0 ? (
              <Tag
                color={isBrowserMode ? 'purple' : 'blue'}
                className="m-0! cursor-pointer px-3 py-1 hover:opacity-80 transition-opacity flex items-center gap-1.5 text-sm font-medium"
                onClick={() => props.onOpenConcurrency(isBrowserMode ? 'browser' : 'http')}
              >
                <ThunderboltOutlined />
                <span>
                  {isBrowserMode ? '浏览器' : 'HTTP'} 并发: {allocatedConcurrency}
                </span>
              </Tag>
            ) : (
              <Tag
                color="warning"
                className="m-0! cursor-pointer px-3 py-1 hover:opacity-80 transition-opacity flex items-center gap-1.5 text-sm font-medium"
                onClick={() => props.onOpenConcurrency(isBrowserMode ? 'browser' : 'http')}
              >
                <HourglassOutlined />
                <span>排队中 (0 并发)</span>
              </Tag>
            )}
          </Tooltip>

          <div className="flex items-center gap-1.5 text-sm text-[var(--ant-color-text-secondary)]">
            <span>预计剩余</span>
            <Typography.Text strong className="text-sm font-mono text-[var(--ant-color-text)]">
              {remaining === null ? '计算中' : formatDuration(remaining)}
            </Typography.Text>
          </div>

          <div className="flex items-center gap-1.5 text-sm text-[var(--ant-color-text-secondary)]">
            <span>优先级</span>
            <Select
              aria-label="任务优先级"
              value={job.priority}
              className="w-24"
              options={[
                { value: 100, label: '高优先' },
                { value: 0, label: '普通' },
                { value: -50, label: '低优先' }
              ]}
              onChange={(value) => props.onPriorityChange(job, value)}
            />
          </div>
        </div>
      </div>

      {/* 进度与当前抓取目标区 */}
      <div className="mt-3 rounded-md bg-[var(--ant-color-bg-container)] p-4 border border-[var(--ant-color-border-secondary)]">
        <div className="mb-2.5 flex items-center justify-between gap-3 text-sm">
          <div className="flex min-w-0 items-center gap-2 text-[var(--ant-color-text)]">
            <FileTextOutlined className="text-[var(--ant-color-primary)] shrink-0" />
            {progressView.kind === 'indeterminate' && <ProgressIndeterminate />}
            <span className="truncate font-mono text-sm" title={progressView.current}>
              {progressView.current}
            </span>
          </div>
          <span className="shrink-0 font-medium tabular-nums text-sm text-[var(--ant-color-text)]">
            {progressView.kind === 'determinate'
              ? `${progressView.processed} / ${progressView.total} 页 (${progressView.percent}%)`
              : '准备中'}
          </span>
        </div>

        {progressView.kind === 'determinate' ? (
          <Progress
            percent={progressView.percent}
            showInfo={false}
            status={job.status === 'running' ? 'active' : 'normal'}
            strokeColor={{ from: 'var(--ant-color-primary)', to: 'var(--ant-color-info)' }}
            className="m-0! block!"
          />
        ) : (
          <div className="h-2.5 rounded-full bg-[var(--ant-color-fill-secondary)] animate-pulse" />
        )}

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ant-color-text-secondary)]">
          <div className="flex items-center gap-3">
            <span>已抓取 {formatBytes(job.contentBytes)}</span>
            {elapsed !== null && <span>· 已耗时 {formatDuration(elapsed)}</span>}
            <span>· 创建于 {formatDateTime(job.scheduledAt)}</span>
          </div>

          <div className="flex items-center gap-2">
            <ConfirmedActionButton
              title="暂停这个任务？"
              description="当前页面请求完成后暂停，已保存的检查点会保留。"
              label="暂停任务"
              icon={<PauseOutlined />}
              loading={loading('pause')}
              disabled={status === 'pausing' || status === 'stopping'}
              onConfirm={() => props.onJobAction(job, 'pause')}
            />
            <ConfirmedActionButton
              title="结束并保留已抓取内容？"
              description="已完成内容会立即提交，剩余页面可在以后继续。"
              label="保存并结束"
              icon={<StopOutlined />}
              loading={loading('stop')}
              disabled={status === 'stopping'}
              onConfirm={() => props.onJobAction(job, 'stop')}
            />
            <Tooltip title="取消后续抓取">
              <ConfirmedActionButton
                danger
                title="取消后续抓取？"
                description="任务会停止继续领取页面；已经成功写入的文档会保留。"
                label="取消抓取"
                icon={<CloseOutlined />}
                loading={loading('cancel')}
                onConfirm={() => props.onJobAction(job, 'cancel')}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 聚合关联历史失败信息 */}
      {relatedFailures.length > 0 && (
        <div className="mt-3 rounded border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)]/20 px-4 py-2.5 text-sm transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[var(--ant-color-error)] font-medium">
              <ExclamationCircleOutlined />
              <span>已关联 {relatedFailures.length} 条历史失败重试记录</span>
            </div>
            <Button
              type="link"
              className="p-0! text-sm text-[var(--ant-color-error)]"
              icon={showFailures ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setShowFailures(!showFailures)}
            >
              {showFailures ? '收起详情' : '查看历史失败记录'}
            </Button>
          </div>

          {showFailures && (
            <div className="mt-2 divide-y divide-[var(--ant-color-error-border)] border-t border-[var(--ant-color-error-border)] pt-1.5 text-[11px] text-[var(--ant-color-text-secondary)]">
              {relatedFailures.map((failure) => (
                <div key={failure.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="truncate max-w-md" title={failure.error ?? '异常中断'}>
                    · {failure.error ?? '后台任务连续中断，已停止自动重试'}
                  </span>
                  <span className="shrink-0 text-[var(--ant-color-text-tertiary)]">
                    {formatDateTime(failure.scheduledAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function ProgressIndeterminate(): React.JSX.Element {
  return (
    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_4px_rgba(59,130,246,0.5)] shrink-0" />
  )
}

const statusLabels: Record<string, string> = {
  running: '运行中',
  pending: '等待中',
  pausing: '正在暂停',
  stopping: '正在结束'
}
