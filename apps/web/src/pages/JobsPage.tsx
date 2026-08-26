import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Progress } from 'antd'
import { cancelJob, listJobs } from '@/api/jobs'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'
import { triggerLabel } from '@/utils/status-labels'

const jobDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

export function JobsPage(): React.JSX.Element {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: listJobs })
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void message.success('已请求停止任务')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="后台任务"
        description="任务写入本机数据库并由独立 worker 执行，关闭 UI 不会中断抓取。"
      />
      <AsyncState
        loading={jobs.isLoading}
        error={jobs.error}
        empty={jobs.data?.length === 0}
        emptyText="任务队列还是空的"
        onRetry={() => void jobs.refetch()}
      >
        <div className="panel overflow-hidden">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[#f5f8f8] text-xs text-muted uppercase">
              <tr>
                <th className="px-5 py-3.5 font-650">来源</th>
                <th className="px-5 py-3.5 font-650">状态</th>
                <th className="px-5 py-3.5 font-650">进度</th>
                <th className="px-5 py-3.5 font-650">触发</th>
                <th className="px-5 py-3.5 font-650">时间</th>
                <th className="px-5 py-3.5 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5ecec]">
              {jobs.data?.map((job) => {
                const source = sources.data?.find((item) => item.id === job.sourceId)
                return (
                  <tr key={job.id} className="hover:bg-[#f9fbfa]">
                    <td className="px-5 py-3.5">
                      <div className="font-650">{source?.name ?? '来源同步'}</div>
                      <div className="mt-0.5 max-w-xs truncate font-mono text-[11px] text-muted">
                        {job.sourceId}
                      </div>
                      {job.error && (
                        <div className="mt-1.5 max-w-lg text-xs text-[#a33e38]">{job.error}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="w-56 px-5 py-3.5">
                      <JobProgress job={job} />
                    </td>
                    <td className="px-5 py-3.5 text-muted">{triggerLabel(job.trigger)}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {jobDateTimeFormatter.format(new Date(job.createdAt))}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {(job.status === 'pending' || job.status === 'running') && (
                        <Button
                          danger
                          type="text"
                          size="small"
                          loading={cancel.isPending && cancel.variables === job.id}
                          onClick={() => cancel.mutate(job.id)}
                        >
                          停止
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </AsyncState>
    </div>
  )
}

function JobProgress({ job }: { job: import('@loci/shared').LocalJob }): React.JSX.Element {
  const progress = job.result
  if (!progress) return <span className="text-xs text-muted">等待开始</span>
  const total = Math.max(progress.queued, progress.processed)
  const percent = total > 0 ? Math.min(100, Math.round((progress.processed / total) * 100)) : 0
  return (
    <div className="min-w-44">
      <Progress
        percent={percent}
        size="small"
        showInfo={false}
        status={
          job.status === 'failed' ? 'exception' : job.status === 'completed' ? 'success' : 'active'
        }
      />
      <div className="text-xs text-muted">
        已处理 {progress.processed}/{total} · 失败 {progress.failed}
      </div>
      {progress.node && (
        <div className="mt-0.5 truncate text-xs text-muted" title={progress.node.url}>
          {progress.node.status} · {progress.node.title}
        </div>
      )}
    </div>
  )
}
