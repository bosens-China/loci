const JOB_TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  schedule: '定时',
  startup: '启动'
}

export function triggerLabel(trigger: string): string {
  return JOB_TRIGGER_LABELS[trigger] ?? trigger
}
