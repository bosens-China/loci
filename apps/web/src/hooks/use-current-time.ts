import { useEffect, useState } from 'react'

/** 为运行中任务提供稳定的可读耗时刷新，避免在渲染阶段直接读取系统时间。 */
export function useCurrentTime(enabled = true, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
  return now
}
