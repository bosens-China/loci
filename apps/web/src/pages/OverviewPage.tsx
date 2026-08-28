import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Button, Card, Empty, Statistic, Typography } from 'antd'
import { listJobs } from '@/api/jobs'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'

/** 概览页：核心指标统计、近期任务记录与定时同步计划。 */
export function OverviewPage(): React.JSX.Element {
  const navigate = useNavigate()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: listJobs })
  const error = sources.error ?? jobs.error
  const active =
    jobs.data?.filter((job) => job.status === 'pending' || job.status === 'running') ?? []
  const attention = sources.data?.filter((source) => source.status === 'attention').length ?? 0
  const scheduled =
    sources.data?.filter((source) => source.schedule || source.cloud?.autoSync) ?? []
  const documentCount = sources.data?.reduce((count, source) => count + source.pages, 0) ?? 0
  const recentJobs = (jobs.data ?? []).slice(0, 8)
  const recentSchedules = scheduled.slice(0, 8)

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader title="概览" />
      <AsyncState loading={sources.isLoading || jobs.isLoading} error={error}>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="文档来源"
            value={sources.data?.length ?? 0}
            note={`${scheduled.length} 个定时计划`}
            onClick={() => void navigate({ to: '/documents' })}
          />
          <MetricCard
            title="已收录页面"
            value={documentCount}
            note="本机 SQLite 索引"
            onClick={() => void navigate({ to: '/documents' })}
          />
          <MetricCard
            title="活动任务"
            value={active.length}
            note="支持重启后恢复"
            contentStyle={active.length > 0 ? { color: 'var(--ant-color-primary)' } : undefined}
            onClick={() => void navigate({ to: '/jobs' })}
          />
          <MetricCard
            title="需要处理"
            value={attention}
            note="失败或需关注"
            contentStyle={attention > 0 ? { color: 'var(--ant-color-error)' } : undefined}
            onClick={() => void navigate({ to: '/documents' })}
          />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card
            title="最近任务"
            extra={
              <Button type="link" size="small" onClick={() => void navigate({ to: '/jobs' })}>
                查看全部
              </Button>
            }
            styles={{ body: { padding: '8px 0' } }}
          >
            <div className="max-h-96 overflow-y-auto px-4">
              {recentJobs.length ? (
                <ul className="m-0 list-none p-0">
                  {recentJobs.map((job) => {
                    const source = sources.data?.find((item) => item.id === job.sourceId)
                    return (
                      <li
                        key={job.id}
                        className="flex items-center gap-3 border-b border-[var(--ant-color-split)] py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <Typography.Text strong className="block truncate">
                            {source?.name ?? '来源同步'}
                          </Typography.Text>
                          <Typography.Text
                            type="secondary"
                            className="block truncate font-mono text-xs"
                          >
                            {job.sourceId}
                          </Typography.Text>
                        </div>
                        <StatusPill status={job.status} />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <Empty className="py-8" description="还没有执行过任务" />
              )}
            </div>
          </Card>

          <Card title="定时计划" styles={{ body: { padding: '8px 0' } }}>
            <div className="max-h-96 overflow-y-auto px-4">
              {recentSchedules.length ? (
                <ul className="m-0 list-none p-0">
                  {recentSchedules.map((source) => (
                    <li
                      key={source.id}
                      className="border-b border-[var(--ant-color-split)] last:border-b-0"
                    >
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center py-3 text-left transition-colors hover:bg-[var(--ant-color-fill-quaternary)]"
                        onClick={() =>
                          void navigate({ to: '/documents', search: { source: source.id } })
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <Typography.Text strong className="block truncate">
                            {source.name}
                          </Typography.Text>
                          <Typography.Text
                            type="secondary"
                            className="block truncate font-mono text-xs"
                          >
                            {source.cloud?.autoSync ? '每日检查' : source.schedule}
                          </Typography.Text>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="py-8" description="尚未设置定时同步" />
              )}
            </div>
          </Card>
        </section>
      </AsyncState>
    </div>
  )
}

function MetricCard(props: {
  title: string
  value: number
  note: string
  contentStyle?: React.CSSProperties
  onClick: () => void
}): React.JSX.Element {
  return (
    <Card hoverable className="cursor-pointer" onClick={props.onClick}>
      <Statistic
        title={<Typography.Text type="secondary">{props.title}</Typography.Text>}
        value={props.value}
        styles={props.contentStyle ? { content: props.contentStyle } : undefined}
      />
      <Typography.Text type="secondary" className="mt-1 block text-xs">
        {props.note}
      </Typography.Text>
    </Card>
  )
}
