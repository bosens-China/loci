import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button } from 'antd'
import dayjs from 'dayjs'
import { cancelJob, listJobs } from '@/api/jobs'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'

export function JobsPage(): React.JSX.Element {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['jobs'], queryFn: listJobs })
  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void message.success('已请求停止任务')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  return (
    <>
      <PageHeader
        eyebrow="Durable queue"
        title="后台任务"
        description="任务写入本机数据库；关闭 UI 或服务短暂重启，都不会让已接受的工作凭空消失。"
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyText="任务队列还是空的"
        onRetry={() => void query.refetch()}
      >
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-760px border-collapse text-left text-sm">
            <thead className="bg-[#f5f8f8] text-xs tracking-[.08em] text-[#667a7c] uppercase">
              <tr>
                <th className="px-5 py-4">任务</th>
                <th className="px-5 py-4">状态</th>
                <th className="px-5 py-4">触发</th>
                <th className="px-5 py-4">时间</th>
                <th className="px-5 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5ecec]">
              {query.data?.map((job) => (
                <tr key={job.id} className="hover:bg-[#f9fbfa]">
                  <td className="px-5 py-4">
                    <div className="font-650">来源同步</div>
                    <div className="mt-1 max-w-64 truncate font-mono text-[11px] text-[#718486]">
                      {job.sourceId}
                    </div>
                    {job.error && (
                      <div className="mt-2 max-w-md text-xs text-[#a33e38]">{job.error}</div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill status={job.status} />
                  </td>
                  <td className="px-5 py-4 text-[#53696b]">{job.trigger}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-[#53696b]">
                    {dayjs(job.createdAt).format('MM-DD HH:mm:ss')}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {(job.status === 'pending' || job.status === 'running') && (
                      <Button
                        danger
                        type="text"
                        loading={cancel.isPending && cancel.variables === job.id}
                        onClick={() => cancel.mutate(job.id)}
                      >
                        停止
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncState>
    </>
  )
}
