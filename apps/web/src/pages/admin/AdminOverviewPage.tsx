import { BookOutlined, ControlOutlined, EyeOutlined, SyncOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Empty, Space, Statistic, Tag, Typography } from 'antd'
import { useNavigate } from '@tanstack/react-router'
import { getAdminCrawlSettings, listAdminJobs, listAdminLibraries } from '@/api/admin'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'
import { ADMIN_CRAWL_SETTINGS_KEY } from './AdminCrawlSettingsPanel'
import { ADMIN_JOBS_KEY, ADMIN_LIBRARIES_KEY } from './admin-query-keys'
import { isAdminJobActive } from './admin-state'

/** Server 管理首页只聚合现有权威接口，不维护第二份统计状态。 */
export function AdminOverviewPage(): React.JSX.Element {
  const navigate = useNavigate()
  const libraries = useQuery({ queryKey: ADMIN_LIBRARIES_KEY, queryFn: listAdminLibraries })
  const jobs = useQuery({
    queryKey: ADMIN_JOBS_KEY,
    queryFn: listAdminJobs,
    refetchInterval: ({ state }) => (state.data?.some(isAdminJobActive) ? 1_000 : 5_000)
  })
  const settings = useQuery({
    queryKey: ADMIN_CRAWL_SETTINGS_KEY,
    queryFn: getAdminCrawlSettings
  })
  const error = libraries.error ?? jobs.error ?? settings.error
  const activeJobs = (jobs.data ?? []).filter(isAdminJobActive)
  const published = (libraries.data ?? []).filter((item) => item.revision)
  const recentJobs = (jobs.data ?? []).slice(0, 6)

  return (
    <>
      <PageHeader
        title="Server 概览"
        description="查看远端文档库发布状态、同步队列和当前抓取策略。"
        action={
          <Space>
            <Button
              icon={<BookOutlined />}
              onClick={() => void navigate({ to: '/admin/libraries' })}
            >
              管理文档库
            </Button>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={() => void navigate({ to: '/admin/jobs' })}
            >
              查看任务
            </Button>
          </Space>
        }
      />
      <AsyncState
        loading={libraries.isLoading || jobs.isLoading || settings.isLoading}
        error={error}
        onRetry={() => void Promise.all([libraries.refetch(), jobs.refetch(), settings.refetch()])}
      >
        <div className="grid gap-4 lg:grid-cols-4">
          <MetricCard title="Server 文档库" value={libraries.data?.length ?? 0} />
          <MetricCard title="已发布公开库" value={published.length} />
          <MetricCard title="活动任务" value={activeJobs.length} />
          <MetricCard title="最大并行任务" value={settings.data?.maxConcurrentJobs ?? 0} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card
            title="最近任务"
            extra={
              <Button type="link" size="small" onClick={() => void navigate({ to: '/admin/jobs' })}>
                查看全部
              </Button>
            }
          >
            {recentJobs.length ? (
              <div className="space-y-3">
                {recentJobs.map((job) => {
                  const library = libraries.data?.find((item) => item.id === job.libraryId)
                  return (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-4 border-b border-[var(--ant-color-border-secondary)] pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <Typography.Text strong className="block truncate">
                          {library?.name ?? job.libraryId}
                        </Typography.Text>
                        <Typography.Text type="secondary" className="text-xs">
                          {formatDateTime(job.updatedAt)}
                        </Typography.Text>
                      </div>
                      <Tag color={isAdminJobActive(job) ? 'processing' : undefined}>
                        {job.status}
                      </Tag>
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无同步任务" />
            )}
          </Card>

          <Card title="快捷入口">
            <div className="grid gap-3">
              <Button
                block
                icon={<EyeOutlined />}
                onClick={() => void navigate({ to: '/admin/catalog' })}
              >
                预览公开目录
              </Button>
              <Button
                block
                icon={<ControlOutlined />}
                onClick={() => void navigate({ to: '/admin/hostname-policies' })}
              >
                调整抓取策略
              </Button>
            </div>
          </Card>
        </div>
      </AsyncState>
    </>
  )
}

function MetricCard(props: { title: string; value: number }): React.JSX.Element {
  return (
    <Card>
      <Statistic title={props.title} value={props.value} />
    </Card>
  )
}
