export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value)
  return date ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date) : '—'
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value)
  return date
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(date)
    : '—'
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    milliseconds < 0 ||
    Number.isNaN(milliseconds)
  ) {
    return '—'
  }
  const totalSeconds = Math.round(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}
