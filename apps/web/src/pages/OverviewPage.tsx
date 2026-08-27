import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { listJobs } from '@/api/jobs'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="概览" />
      <AsyncState loading={sources.isLoading || jobs.isLoading} error={error}>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="文档来源"
            value={sources.data?.length ?? 0}
            note={`${scheduled.length} 个定时计划`}
            onClick={() => void navigate({ to: '/documents' })}
          />
          <MetricCard
            label="已收录页面"
            value={documentCount}
            note="本机 SQLite 索引"
            onClick={() => void navigate({ to: '/documents' })}
          />
          <MetricCard
            label="活动任务"
            value={active.length}
            note="支持重启后恢复"
            accent={active.length > 0}
            onClick={() => void navigate({ to: '/jobs' })}
          />
          <MetricCard
            label="需要处理"
            value={attention}
            note="失败或需关注"
            warn={attention > 0}
            onClick={() => void navigate({ to: '/documents' })}
          />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="panel overflow-hidden">
            <div className="pane-header">
              <span className="pane-title">最近任务</span>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => void navigate({ to: '/jobs' })}
              >
                查看全部
              </button>
            </div>
            <div className="max-h-96 divide-y divide-[#e8eded] overflow-y-auto px-4">
              {(jobs.data ?? []).slice(0, 8).map((job) => {
                const source = sources.data?.find((item) => item.id === job.sourceId)
                return (
                  <div key={job.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-650">{source?.name ?? '来源同步'}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                        {job.sourceId}
                      </div>
                    </div>
                    <StatusPill status={job.status} />
                  </div>
                )
              })}
              {jobs.data?.length === 0 && (
                <p className="py-10 text-center text-sm text-muted">还没有执行过任务</p>
              )}
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="pane-header">
              <span className="pane-title">定时计划</span>
            </div>
            <div className="max-h-96 overflow-y-auto p-4">
              {scheduled.slice(0, 8).map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="focus-ring mb-2 block w-full rounded-lg px-3 py-2.5 text-left hover:bg-[#f3f7f6]"
                  onClick={() => void navigate({ to: '/documents', search: { source: source.id } })}
                >
                  <div className="text-sm font-650">{source.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">
                    {source.cloud?.autoSync ? '每日检查' : source.schedule}
                  </div>
                </button>
              ))}
              {scheduled.length === 0 && (
                <p className="py-10 text-center text-sm text-muted">尚未设置定时同步</p>
              )}
            </div>
          </div>
        </section>
      </AsyncState>
    </div>
  )
}

function MetricCard(props: {
  label: string
  value: number
  note: string
  accent?: boolean
  warn?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`focus-ring panel p-5 text-left transition-transform hover:-translate-y-0.5 ${
        props.accent ? 'bg-accent text-white' : props.warn ? 'ring-1 ring-[#d38a22]/40' : ''
      }`}
    >
      <div
        className={`text-xs font-650 tracking-wide uppercase ${
          props.accent ? 'text-white/70' : 'text-muted'
        }`}
      >
        {props.label}
      </div>
      <div className="mt-2 font-serif text-4xl font-600">{props.value}</div>
      <div className={`mt-1.5 text-xs ${props.accent ? 'text-white/75' : 'text-muted'}`}>
        {props.note}
      </div>
    </button>
  )
}
