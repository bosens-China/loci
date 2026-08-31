import {
  CaretRightOutlined,
  CheckCircleFilled,
  CopyOutlined,
  PauseCircleFilled,
  StopFilled
} from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { App, Button, Tooltip, Typography } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { triggerLabel } from '@/utils/status-labels'
import { jobViewStatus, localJobElementId } from './job-state'

interface CompletedJobItemProps {
  job: LocalJob
  sourceNames: ReadonlyMap<string, string>
  pendingAction?: string
  onContinue: (job: LocalJob) => void
  onJobAction: (job: LocalJob, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
}

/** 已完成 / 已暂停 / 历史任务紧凑行 */
export function CompletedJobItem(props: CompletedJobItemProps): React.JSX.Element {
  const { message } = App.useApp()
  const { job } = props
  const status = jobViewStatus(job)
  const elapsed =
    job.startedAt && job.finishedAt
      ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
      : null

  const handleCopyId = (): void => {
    void navigator.clipboard.writeText(job.id)
    void message.success('已复制任务 ID')
  }

  const loading = (action: string): boolean => props.pendingAction === `${action}:${job.id}`

  return (
    <article
      id={localJobElementId(job.id)}
      className="scroll-m-4 flex items-center justify-between gap-4 px-3 py-3 rounded-md transition-colors hover:bg-[var(--ant-color-fill-quaternary)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <StatusIcon status={status} />

        <div className="flex min-w-0 items-center gap-2.5">
          <Typography.Text strong className="truncate text-sm text-[var(--ant-color-text)]">
            {props.sourceNames.get(job.sourceId) ?? '文档同步'}
          </Typography.Text>
          <span className="text-sm text-[var(--ant-color-text-tertiary)]">
            ({triggerLabel(job.trigger)})
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-sm text-[var(--ant-color-text-secondary)]">
          <span>{job.result?.processed ?? 0} 页</span>
          <span>·</span>
          <span>{formatBytes(job.contentBytes)}</span>
          {elapsed !== null && (
            <>
              <span>·</span>
              <span>耗时 {formatDuration(elapsed)}</span>
            </>
          )}
          {job.remainingCount > 0 && (
            <span className="text-amber-600 font-medium">· 剩余待处理 {job.remainingCount} 页</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm text-[var(--ant-color-text-tertiary)]">
          {formatDateTime(job.scheduledAt)}
        </span>

        {status === 'paused' && (
          <ConfirmedActionButton
            title="恢复这个任务？"
            label="恢复任务"
            icon={<CaretRightOutlined />}
            loading={loading('resume')}
            onConfirm={() => props.onJobAction(job, 'resume')}
          />
        )}

        {status === 'stopped' && (
          <ConfirmedActionButton
            title="继续执行未完成的任务？"
            description="将复用原任务 ID，并从上次保存的检查点继续抓取。"
            label="继续抓取"
            icon={<CaretRightOutlined />}
            loading={loading('continue')}
            onConfirm={() => props.onContinue(job)}
          />
        )}

        <Tooltip title={`任务 ID: ${job.id} (点击复制)`}>
          <Button
            type="text"
            icon={<CopyOutlined className="text-[var(--ant-color-text-tertiary)]" />}
            onClick={handleCopyId}
          />
        </Tooltip>
      </div>
    </article>
  )
}

function StatusIcon({ status }: { status: ReturnType<typeof jobViewStatus> }): React.JSX.Element {
  if (status === 'completed') {
    return <CheckCircleFilled className="text-emerald-500 text-sm shrink-0" />
  }
  if (status === 'paused') {
    return <PauseCircleFilled className="text-amber-500 text-sm shrink-0" />
  }
  if (status === 'stopped') {
    return <StopFilled className="text-gray-400 text-sm shrink-0" />
  }
  return <div className="h-2.5 w-2.5 rounded-full bg-gray-400 shrink-0" />
}
