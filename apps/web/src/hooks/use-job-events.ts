import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** 服务推送只承担失效通知，页面数据仍统一由 Query 缓存读取。 */
export function useJobEvents(enabled: boolean): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const events = new EventSource('/api/events', { withCredentials: true })
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['sources'] })
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    }
    events.addEventListener('job', refresh)
    return () => events.close()
  }, [enabled, queryClient])
}
