import { SyncOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Badge, Button, Popover, Progress, Typography } from 'antd'
import { listJobs } from '@/api/jobs'

/** 顶栏活动任务指示器：有任务时展示旋转图标与进度浮层，无任务时隐藏保持顶栏清爽。 */
export function ActiveTaskIndicator(): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs
  })

  const activeJobs = (query.data ?? []).filter((j) => j.status === 'running')
  const count = activeJobs.length

  // 无任务时：保持顶栏清爽不渲染
  if (count === 0) {
    return null
  }

  const popoverContent = (
    <div className="w-64 space-y-3 py-1">
      <div className="flex items-center justify-between border-b border-[var(--ant-color-border-secondary)] pb-2">
        <Typography.Text strong className="text-xs">
          正在运行的任务 ({count})
        </Typography.Text>
        <Link to="/jobs" className="text-xs text-[var(--ant-color-primary)]">
          查看全部
        </Link>
      </div>
      <div className="space-y-2">
        {activeJobs.slice(0, 3).map((job) => {
          const total = (job.result?.processed ?? 0) + (job.remainingCount ?? 0)
          const percent = total > 0 ? Math.round(((job.result?.processed ?? 0) / total) * 100) : 0
          return (
            <div key={job.id} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate font-medium">{job.hostname}</span>
                <span className="text-[var(--ant-color-text-secondary)]">{percent}%</span>
              </div>
              <Progress percent={percent} size="small" status="active" showInfo={false} />
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <Popover content={popoverContent} trigger={['hover', 'click']} placement="bottomRight" arrow>
      <Link to="/jobs">
        <Button
          type="text"
          className="flex h-8 w-8 items-center justify-center p-0 text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
          aria-label="查看进行中的任务"
        >
          <Badge count={count} size="small" offset={[4, -2]}>
            <SyncOutlined spin className="text-sm text-[var(--ant-color-primary)]" />
          </Badge>
        </Button>
      </Link>
    </Popover>
  )
}
