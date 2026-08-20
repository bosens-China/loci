import { useQuery } from '@tanstack/react-query'
import { listDocuments } from '@/api/documents'
import { listJobs } from '@/api/jobs'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'

export function OverviewPage(): React.JSX.Element {
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const documents = useQuery({ queryKey: ['documents', ''], queryFn: () => listDocuments() })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: listJobs })
  const error = sources.error ?? documents.error ?? jobs.error
  const active =
    jobs.data?.filter((job) => job.status === 'pending' || job.status === 'running') ?? []
  const scheduled =
    sources.data?.filter((source) => source.schedule || source.cloud?.autoSync) ?? []

  return (
    <>
      <PageHeader
        eyebrow="Service ledger"
        title="本地文档，一直在工作"
        description="浏览器只是控制面板。来源抓取、定时计划和任务恢复都由当前用户的后台服务持续处理。"
      />
      <AsyncState
        loading={sources.isLoading || documents.isLoading || jobs.isLoading}
        error={error}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="文档来源"
            value={sources.data?.length ?? 0}
            note={`${scheduled.length} 个定时计划`}
          />
          <Metric label="已收录页面" value={documents.data?.length ?? 0} note="本机 SQLite 索引" />
          <Metric label="活动任务" value={active.length} note="支持重启后恢复" accent />
          <Metric
            label="需要处理"
            value={sources.data?.filter((source) => source.status === 'attention').length ?? 0}
            note="失败或需要关注"
          />
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <div className="panel p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="eyebrow">Queue</div>
                <h2 className="mb-0 mt-1 text-lg font-700">最近任务</h2>
              </div>
              <span className="font-mono text-xs text-[#718486]">
                {jobs.data?.length ?? 0} records
              </span>
            </div>
            <div className="divide-y divide-[#e7eded]">
              {(jobs.data ?? []).slice(0, 6).map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-650">来源同步</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-[#718486]">
                      {job.sourceId}
                    </div>
                  </div>
                  <StatusPill status={job.status} />
                </div>
              ))}
              {jobs.data?.length === 0 && (
                <p className="py-8 text-center text-sm text-[#718486]">还没有执行过任务</p>
              )}
            </div>
          </div>
          <div className="panel overflow-hidden">
            <div className="border-b border-[#e1e8e8] bg-[#f7faf9] px-5 py-4">
              <div className="eyebrow">Schedules</div>
              <h2 className="mb-0 mt-1 text-lg font-700">定时书签</h2>
            </div>
            <div className="p-5">
              {scheduled.slice(0, 6).map((source, index) => (
                <div
                  key={source.id}
                  className={`relative border-l-3 py-2 pl-4 ${index % 2 ? 'border-[#c77a17]' : 'border-[#0a7c86]'}`}
                >
                  <div className="text-sm font-650">{source.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-[#718486]">
                    {source.cloud?.autoSync ? '每日检查' : source.schedule}
                  </div>
                </div>
              ))}
              {scheduled.length === 0 && (
                <p className="py-8 text-center text-sm text-[#718486]">尚未设置定时同步</p>
              )}
            </div>
          </div>
        </section>
      </AsyncState>
    </>
  )
}

function Metric(props: {
  label: string
  value: number
  note: string
  accent?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`panel relative overflow-hidden p-5 ${props.accent ? 'bg-[#0a7c86] text-white' : ''}`}
    >
      <div
        className={`text-xs font-700 tracking-[.12em] uppercase ${props.accent ? 'text-white/70' : 'text-[#718486]'}`}
      >
        {props.label}
      </div>
      <div className="mt-3 font-serif text-4xl font-600">{props.value}</div>
      <div className={`mt-2 text-xs ${props.accent ? 'text-white/72' : 'text-[#718486]'}`}>
        {props.note}
      </div>
    </div>
  )
}
