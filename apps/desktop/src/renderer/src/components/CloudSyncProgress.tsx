import { Progress, Tag, Typography } from 'antd'
import type { CloudSyncJob } from '@loci/shared'
import { getCloudSyncPercent, isCloudSyncJobActive } from './cloud-sync-progress'

export function CloudSyncProgress({ job }: { job?: CloudSyncJob }): React.JSX.Element {
  if (!job) return <Typography.Text type="secondary">—</Typography.Text>
  if (job.status === 'failed') {
    return (
      <div className="max-w-40">
        <Tag color="error">同步失败</Tag>
        <Typography.Text
          type="danger"
          className="mt-1 block truncate text-xs"
          title={job.error ?? ''}
        >
          {job.error ?? '请检查服务端日志'}
        </Typography.Text>
      </div>
    )
  }
  if (!job.progress) {
    return <Tag color="processing">等待开始</Tag>
  }

  const { processed, queued, failed } = job.progress
  const active = isCloudSyncJobActive(job)
  const status =
    job.status === 'completed_with_errors' ? 'exception' : active ? 'active' : 'success'

  return (
    <div className="w-40">
      <Progress percent={getCloudSyncPercent(job)} status={status} size="small" showInfo={false} />
      <Typography.Text type={failed ? 'warning' : 'secondary'} className="block text-xs">
        {active
          ? `已处理 ${processed} · 待处理 ${queued}`
          : failed
            ? `完成 ${processed} · 失败 ${failed}`
            : `完成 ${processed} 页`}
      </Typography.Text>
    </div>
  )
}
