import { useState } from 'react'
import {
  DownOutlined,
  ExclamationCircleOutlined,
  RedoOutlined,
  RightCircleOutlined,
  UpOutlined
} from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { Badge, Button, Tooltip, Typography } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes, formatDateTime } from '@/utils/format'
import { triggerLabel } from '@/utils/status-labels'
import { jobViewStatus, localJobElementId } from './job-state'

interface FailedJobItemProps {
  job: LocalJob
  additionalFailures?: LocalJob[]
  sourceNames: ReadonlyMap<string, string>
  pendingAction?: string
  activeReplacement?: LocalJob
  onContinue: (job: LocalJob) => void
  onViewActiveJob: (job: LocalJob) => void
}

/** 失败 / 异常中断任务诊断卡片（精简去噪，不显示无意义的 0 进度） */
export function FailedJobItem(props: FailedJobItemProps): React.JSX.Element {
  const { activeReplacement, job, additionalFailures = [] } = props
  const [showDetails, setShowDetails] = useState(false)
  const status = jobViewStatus(job)
  const loading = props.pendingAction === `continue:${job.id}`

  const allFailures = [job, ...additionalFailures]
  const processed = job.result?.processed ?? 0
  const hasPartialContent = processed > 0 || job.contentBytes > 0

  return (
    <article
      id={localJobElementId(job.id)}
      className="scroll-m-4 rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)]/20 p-4 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge status="error" />
          <Typography.Text strong className="truncate text-sm text-[var(--ant-color-text)]">
            {props.sourceNames.get(job.sourceId) ?? '文档同步'}
          </Typography.Text>
          <span className="rounded bg-[var(--ant-color-error-bg)] px-2 py-0.5 text-sm text-[var(--ant-color-error)] font-medium">
            {status === 'failed' ? '同步失败' : '已取消'}
          </span>
          {additionalFailures.length > 0 && (
            <span className="text-sm text-[var(--ant-color-error)] font-medium">
              (共 {allFailures.length} 次失败)
            </span>
          )}
          <span className="text-sm text-[var(--ant-color-text-secondary)]">
            · {triggerLabel(job.trigger)} · {formatDateTime(job.scheduledAt)}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {activeReplacement ? (
            <Button
              type="primary"
              ghost
              icon={<RightCircleOutlined />}
              onClick={() => props.onViewActiveJob(activeReplacement)}
            >
              查看运行中任务
            </Button>
          ) : (
            <ConfirmedActionButton
              title="重新提交这个任务？"
              description="将复用原任务并重新执行；已有文档内容会保留到成功提交。"
              label={additionalFailures.length > 0 ? '重试最新任务' : '重新开始抓取'}
              icon={<RedoOutlined />}
              type="primary"
              danger
              loading={loading}
              onConfirm={() => props.onContinue(job)}
            />
          )}

          {additionalFailures.length > 0 && (
            <Button
              type="link"
              className="p-0! text-sm text-[var(--ant-color-error)]"
              icon={showDetails ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? '收起历史' : '查看全部失败记录'}
            </Button>
          )}
        </div>
      </div>

      {/* 失败诊断信息与断点状态 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 max-w-2xl items-center gap-2 text-[var(--ant-color-error)]">
          <ExclamationCircleOutlined className="shrink-0" />
          <Tooltip title={job.error ?? '未知错误'} placement="bottomLeft">
            <span className="truncate font-medium">
              失败原因：{job.error ?? '任务异常中断，未返回明确错误原因'}
            </span>
          </Tooltip>
        </div>

        {/* 仅在确实处理了部分页面时展示断点位置，不再机械展示 0 页 0 B */}
        {hasPartialContent && (
          <div className="flex shrink-0 items-center gap-2 text-[var(--ant-color-text-secondary)]">
            <span>中断于第 {processed} 页</span>
            <span>·</span>
            <span>已抓取 {formatBytes(job.contentBytes)}</span>
            {job.remainingCount > 0 && <span>· 剩余 {job.remainingCount} 页待抓取</span>}
          </div>
        )}
      </div>

      {/* 展开历史失败记录 */}
      {showDetails && additionalFailures.length > 0 && (
        <div className="mt-2.5 divide-y divide-[var(--ant-color-error-border)] border-t border-[var(--ant-color-error-border)] pt-1.5 text-[11px] text-[var(--ant-color-text-secondary)]">
          {additionalFailures.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 py-1">
              <span className="truncate max-w-md" title={item.error ?? '异常中断'}>
                · {item.error ?? '异常中断'}
              </span>
              <span className="shrink-0 text-[var(--ant-color-text-tertiary)]">
                {formatDateTime(item.scheduledAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
