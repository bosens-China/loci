const styles = {
  healthy: 'bg-[#e4f2eb] text-[#226446]',
  syncing: 'bg-[#e1f1f3] text-[#086a72]',
  attention: 'bg-[#fae9e6] text-[#963b36]',
  pending: 'bg-[#fff0d7] text-[#8b570f]',
  running: 'bg-[#e1f1f3] text-[#086a72]',
  completed: 'bg-[#e4f2eb] text-[#226446]',
  failed: 'bg-[#fae9e6] text-[#963b36]',
  cancelled: 'bg-[#edf0f0] text-[#667476]'
} as const

const labels: Record<keyof typeof styles, string> = {
  healthy: '正常',
  syncing: '同步中',
  attention: '需关注',
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

export function StatusPill({ status }: { status: keyof typeof styles }): React.JSX.Element {
  return (
    <span
      role="status"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-650 ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}
