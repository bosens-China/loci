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

export function StatusPill({ status }: { status: keyof typeof styles }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-650 ${styles[status]}`}
    >
      {status}
    </span>
  )
}
