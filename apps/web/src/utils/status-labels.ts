/** 将内部状态枚举映射为用户可见的中文标签。 */
export const SOURCE_STATUS_LABELS = {
  healthy: '正常',
  syncing: '同步中',
  attention: '需关注'
} as const

export const JOB_STATUS_LABELS = {
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
} as const

export const FETCH_MODE_LABELS = {
  auto: '自动',
  http: 'HTTP',
  browser: '浏览器'
} as const

export const JOB_TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  schedule: '定时',
  startup: '启动'
}

export function triggerLabel(trigger: string): string {
  return JOB_TRIGGER_LABELS[trigger] ?? trigger
}
