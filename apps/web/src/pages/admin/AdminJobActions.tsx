import { CaretRightOutlined, CloseOutlined, PauseOutlined, StopOutlined } from '@ant-design/icons'
import type { CloudSyncJob } from '@loci/shared'
import { Select } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'

type JobAction = 'pause' | 'resume' | 'stop' | 'cancel'

export function AdminJobActions(props: {
  job: CloudSyncJob
  pendingKey: string | undefined
  onControl: (id: string, action: JobAction) => void
  onPriority: (id: string, priority: number) => void
}): React.JSX.Element {
  const { job } = props
  const paused = job.paused || job.pauseRequested
  const active = job.status === 'queued' || job.status === 'running'
  const canResume = paused || job.status === 'failed' || job.partial
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {(active || canResume) && (
        <Select
          size="small"
          aria-label="Server 任务优先级"
          className="w-20"
          value={job.priority}
          loading={props.pendingKey === `priority:${job.id}`}
          options={[
            { value: 50, label: '高' },
            { value: 0, label: '普通' },
            { value: -50, label: '低' }
          ]}
          onChange={(value) => props.onPriority(job.id, value)}
        />
      )}
      {canResume ? (
        <ConfirmedActionButton
          title="恢复这个 Server 任务？"
          label="恢复"
          icon={<CaretRightOutlined />}
          loading={props.pendingKey === `resume:${job.id}`}
          onConfirm={() => props.onControl(job.id, 'resume')}
        />
      ) : active ? (
        <>
          <ConfirmedActionButton
            title="暂停这个 Server 任务？"
            label="暂停"
            icon={<PauseOutlined />}
            loading={props.pendingKey === `pause:${job.id}`}
            onConfirm={() => props.onControl(job.id, 'pause')}
          />
          <ConfirmedActionButton
            title="结束并保留已抓取的 Server 内容？"
            label="结束"
            icon={<StopOutlined />}
            loading={props.pendingKey === `stop:${job.id}`}
            onConfirm={() => props.onControl(job.id, 'stop')}
          />
          <ConfirmedActionButton
            danger
            title="取消并丢弃本次 Server 同步？"
            label="取消"
            icon={<CloseOutlined />}
            loading={props.pendingKey === `cancel:${job.id}`}
            onConfirm={() => props.onControl(job.id, 'cancel')}
          />
        </>
      ) : null}
    </div>
  )
}
