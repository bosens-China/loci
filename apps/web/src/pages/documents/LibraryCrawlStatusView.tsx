import { SyncOutlined } from '@ant-design/icons'
import { Badge, Button, Popover, Progress, Tooltip, Typography } from 'antd'
import type { LibraryCrawlStatus } from '@loci/shared'
import { formatDateTime } from '@/utils/format'

interface CrawlStatusLineProps {
  status?: LibraryCrawlStatus | null
  lastUpdated?: string
}

/**
 * 卡片底部的单行抓取状态：无论处于何种状态都只占一行固定高度，
 * 使网格中所有卡片等高、对齐，避免进度条或错误块撑开卡片。
 */
export function CrawlStatusLine(props: CrawlStatusLineProps): React.JSX.Element {
  return (
    <div className="flex h-6 min-w-0 items-center gap-2">
      <StatusContent {...props} />
    </div>
  )
}

function StatusContent({ status, lastUpdated }: CrawlStatusLineProps): React.JSX.Element {
  const updated = lastUpdated ? `更新于 ${formatDateTime(lastUpdated)}` : '尚未抓取'

  if (status?.status === 'running') {
    const { discovered, processed, currentUrl } = status.progress
    const percent = discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : 0
    return (
      <Tooltip title={currentUrl ?? '正在发现页面'} placement="topLeft">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SyncOutlined spin className="text-[var(--ant-color-primary)]" />
          <Progress percent={percent} size="small" showInfo={false} className="m-0! flex-1" />
          <Typography.Text type="secondary" className="shrink-0 text-xs tabular-nums">
            {processed} / {discovered || '?'}
          </Typography.Text>
        </div>
      </Tooltip>
    )
  }

  const failures = status?.failures ?? []
  if (status?.status === 'failed' || status?.status === 'completed_with_errors') {
    const failed = status.status === 'failed'
    return (
      <>
        <Badge status={failed ? 'error' : 'warning'} />
        <Tooltip title={status.error}>
          <Typography.Text type={failed ? 'danger' : 'warning'} className="truncate text-xs">
            {failed ? '抓取失败' : `部分成功 · ${failures.length} 页失败`}
          </Typography.Text>
        </Tooltip>
        {failures.length > 0 && <FailuresPopover failures={failures} />}
      </>
    )
  }

  return (
    <>
      <Badge status={status?.status === 'cancelled' ? 'default' : 'success'} />
      <Typography.Text type="secondary" className="truncate text-xs">
        {status?.status === 'cancelled' ? `已取消 · ${updated}` : updated}
      </Typography.Text>
    </>
  )
}

function FailuresPopover(props: {
  failures: NonNullable<LibraryCrawlStatus['failures']>
}): React.JSX.Element {
  return (
    <Popover
      placement="bottomLeft"
      trigger="click"
      title={`失败明细（共 ${props.failures.length} 条）`}
      content={
        <div className="max-h-60 w-96 overflow-y-auto">
          {props.failures.map((failure, index) => (
            <div
              key={`${failure.url}-${index}`}
              className="border-b border-b-solid border-[var(--ant-color-split)] py-1.5 last:border-b-0"
            >
              <Typography.Text className="block break-all font-mono text-xs">
                {failure.url}
              </Typography.Text>
              <Typography.Text type="danger" className="text-xs">
                {failure.message}
              </Typography.Text>
            </div>
          ))}
        </div>
      }
    >
      <Button type="link" size="small" className="ml-auto h-auto shrink-0 px-0! text-xs">
        明细
      </Button>
    </Popover>
  )
}
