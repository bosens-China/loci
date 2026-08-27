import { Tag } from 'antd'

const colors = {
  healthy: 'success',
  syncing: 'processing',
  attention: 'error',
  pending: 'warning',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'default'
} as const

const labels: Record<keyof typeof colors, string> = {
  healthy: '正常',
  syncing: '同步中',
  attention: '需关注',
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

export function StatusPill({ status }: { status: keyof typeof colors }): React.JSX.Element {
  return <Tag color={colors[status]}>{labels[status]}</Tag>
}
