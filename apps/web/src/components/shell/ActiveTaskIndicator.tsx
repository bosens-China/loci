import { SyncOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Badge, Button, Popover, Progress, Typography } from 'antd'
import { listLibraryCrawlStatuses } from '@/api/libraries'

/** 顶栏活动抓取指示器：有抓取运行时展示旋转图标与进度浮层，无任务时隐藏保持顶栏清爽。 */
export function ActiveTaskIndicator(): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ['library-crawl-statuses'],
    queryFn: listLibraryCrawlStatuses,
    refetchInterval: (queryState) => {
      const hasRunning = (queryState.state.data ?? []).some((item) => item.status === 'running')
      return hasRunning ? 2000 : 10_000
    }
  })

  const activeCrawls = (query.data ?? []).filter((item) => item.status === 'running')
  const count = activeCrawls.length

  if (count === 0) return null

  const popoverContent = (
    <div className="w-72 space-y-3 py-1">
      <div className="flex items-center justify-between border-b border-[var(--ant-color-border-secondary)] pb-2">
        <Typography.Text strong className="text-xs">
          正在抓取 ({count})
        </Typography.Text>
        <Link to="/documents" className="text-xs text-[var(--ant-color-primary)]">
          查看文档库
        </Link>
      </div>
      <div className="space-y-3">
        {activeCrawls.slice(0, 3).map((item) => {
          const progress = item.progress
          const discovered = progress?.discovered ?? 0
          const processed = progress?.processed ?? 0
          const percent =
            discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : 0
          return (
            <div key={item.libraryId} className="text-xs space-y-1">
              <div className="flex items-center justify-between">
                <Typography.Text className="truncate font-medium max-w-44">
                  {item.libraryId}
                </Typography.Text>
                <span className="text-[var(--ant-color-text-secondary)] font-mono text-[11px]">
                  {processed}/{discovered || '?'}
                </span>
              </div>
              <Progress percent={percent} size="small" status="active" />
              {progress?.currentUrl && (
                <div className="truncate text-[10px] text-[var(--ant-color-text-tertiary)] font-mono">
                  {progress.currentUrl}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <Popover content={popoverContent} trigger={['hover', 'click']} placement="bottomRight" arrow>
      <Link to="/documents">
        <Button
          type="text"
          className="flex h-8 w-8 items-center justify-center p-0 text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
          aria-label="查看进行中的抓取"
        >
          <Badge count={count} size="small" offset={[4, -2]}>
            <SyncOutlined spin className="text-sm text-[var(--ant-color-primary)]" />
          </Badge>
        </Button>
      </Link>
    </Popover>
  )
}
