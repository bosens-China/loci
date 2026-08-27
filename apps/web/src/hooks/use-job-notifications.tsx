import { useEffect, useRef } from 'react'
import type { LocalJob } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { App, Button } from 'antd'
import { listJobs } from '@/api/jobs'

const activeStatuses = new Set<LocalJob['status']>(['pending', 'running'])

/** 在任意页面提示后台任务的终态变化，初次载入的历史任务不会重复打扰用户。 */
export function useJobNotifications(): void {
  const { notification } = App.useApp()
  const navigate = useNavigate()
  const previous = useRef<Map<string, LocalJob['status']> | null>(null)
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: listJobs, refetchInterval: 2_000 })

  useEffect(() => {
    if (!jobs.data) return
    const current = new Map(jobs.data.map((job) => [job.id, job.status]))
    if (previous.current) {
      for (const job of jobs.data) {
        const before = previous.current.get(job.id)
        if (!before || !activeStatuses.has(before) || activeStatuses.has(job.status)) continue
        notifyTerminalJob(notification, job, () => void navigate({ to: '/jobs' }))
      }
    }
    previous.current = current
  }, [jobs.data, navigate, notification])
}

function notifyTerminalJob(
  notification: ReturnType<typeof App.useApp>['notification'],
  job: LocalJob,
  navigateToJobs: () => void
): void {
  const openJobs = (
    <Button size="small" type="link" onClick={navigateToJobs}>
      查看任务
    </Button>
  )
  if (job.status === 'failed') {
    notification.error({
      key: job.id,
      message: `${job.hostname} 抓取失败`,
      description: job.error ?? '请打开任务页查看失败原因。',
      btn: openJobs,
      duration: 8
    })
    return
  }
  if (job.status === 'completed') {
    notification.success({
      key: job.id,
      message: job.partial ? `${job.hostname} 已结束` : `${job.hostname} 抓取完成`,
      description: job.partial
        ? `已保留当前抓取内容，剩余 ${job.remainingCount} 页可继续。`
        : `已处理 ${job.result?.processed ?? 0} 页。`,
      btn: openJobs,
      duration: 6
    })
  }
}
