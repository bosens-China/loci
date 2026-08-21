import { getSchedulePreset, type CloudLibrary, type CloudSyncJob } from '@loci/shared'

export interface AdminTableData {
  headers: string[]
  rows: unknown[][]
}

export function createAdminLibraryTable(libraries: readonly CloudLibrary[]): AdminTableData {
  return {
    headers: ['名称', '范围', '页面', '计划', '发布状态', '最近同步', '错误', '短 ID'],
    rows: libraries.map((library) => [
      library.name,
      library.scopePath,
      library.pages,
      formatAdminSchedule(library.schedule),
      library.lastError ? '需检查' : library.publishedAt ? '已发布' : '待首次同步',
      library.lastCrawledAt ?? '—',
      library.lastError ?? '—',
      library.id.slice(0, 8)
    ])
  }
}

export function createAdminJobTable(jobs: readonly CloudSyncJob[]): AdminTableData {
  return {
    headers: ['任务', '文档库', '状态', '页面进度', '失败页', '创建时间', '完成时间', '错误'],
    rows: jobs.map((job) => [
      job.id.slice(0, 8),
      job.libraryId.slice(0, 8),
      formatAdminJobStatus(job.status),
      formatAdminJobProgress(job),
      Math.max(job.progress?.failed ?? 0, job.failures.length),
      job.createdAt,
      job.finishedAt ?? '—',
      job.error ?? '—'
    ])
  }
}

export function formatAdminSchedule(schedule: string | null): string {
  if (!schedule) return '仅手动'
  return getSchedulePreset(schedule)?.label ?? schedule
}

export function formatAdminJobProgress(job: CloudSyncJob): string {
  if (!job.progress) return isActiveStatus(job.status) ? '等待开始' : '—'
  const { processed, queued } = job.progress
  return isActiveStatus(job.status)
    ? `已处理 ${processed} · 待处理 ${queued}`
    : `完成 ${processed} 页`
}

function formatAdminJobStatus(status: CloudSyncJob['status']): string {
  const labels: Record<CloudSyncJob['status'], string> = {
    queued: '排队中',
    running: '同步中',
    canceling: '正在取消',
    canceled: '已取消',
    completed: '已完成',
    completed_with_errors: '完成但有错误',
    failed: '同步失败'
  }
  return labels[status]
}

function isActiveStatus(status: CloudSyncJob['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'canceling'
}
