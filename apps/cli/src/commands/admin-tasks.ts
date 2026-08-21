import type { CloudAdminClient } from '@loci/runtime'
import type { CloudSyncJob } from '@loci/shared'
import { CliError } from '../errors.js'
import { askConfirm, askSelect, info, printTable, success } from '../ui.js'
import { createAdminJobTable, formatAdminJobProgress } from './admin-output.js'
import { isActiveJob } from './admin-sync.js'

export async function showAdminJobs(client: CloudAdminClient): Promise<void> {
  const jobs = await client.listSyncJobs()
  if (!jobs.length) {
    info('Server 还没有同步任务')
    return
  }
  const table = createAdminJobTable(jobs)
  printTable(table.headers, table.rows)
  success(`共 ${jobs.length} 个同步任务`)
}

export async function cancelAdminJobInteractive(client: CloudAdminClient): Promise<void> {
  const [jobs, libraries] = await Promise.all([client.listSyncJobs(), client.listLibraries()])
  const active = activeAdminJobs(jobs)
  if (!active.length) {
    info('当前没有可以取消的同步任务')
    return
  }
  const names = new Map(libraries.map((library) => [library.id, library.name]))
  const id = await askSelect(
    '请选择要取消的同步任务',
    active.map((job) => ({
      value: job.id,
      label: names.get(job.libraryId) ?? job.libraryId.slice(0, 8),
      hint: `${job.status} · ${formatAdminJobProgress(job)}`
    }))
  )
  const job = active.find((item) => item.id === id)!
  if (
    !(await askConfirm(`确认取消“${names.get(job.libraryId) ?? job.id.slice(0, 8)}”的同步吗？`))
  ) {
    return
  }
  const canceled = await client.cancelSyncJob(job.id)
  success(`已提交取消请求，任务状态：${canceled.status}`)
}

export function activeAdminJobs(jobs: readonly CloudSyncJob[]): CloudSyncJob[] {
  return jobs.filter(isActiveJob)
}

/** 支持任务列表展示的唯一短 ID，同时让完整 ID 优先于前缀匹配。 */
export function resolveAdminJob(jobs: readonly CloudSyncJob[], reference: string): CloudSyncJob {
  const exact = jobs.find((job) => job.id === reference)
  if (exact) return exact
  const matches = jobs.filter((job) => job.id.startsWith(reference))
  if (matches.length === 1) return matches[0]!
  if (!matches.length) throw new CliError(`找不到 Server 同步任务：${reference}`, 2)
  throw new CliError(`同步任务引用不唯一：${reference}`, 2)
}
