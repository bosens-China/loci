import { setTimeout as sleep } from 'node:timers/promises'
import type { CloudLibrary, CloudSyncJob } from '@loci/shared'
import type { CloudAdminClient } from '@loci/runtime'
import { CliError } from '../errors.js'
import { askMultiSelect, createSpinner, warning } from '../ui.js'

export async function syncLibraries(
  client: CloudAdminClient,
  libraries: CloudLibrary[]
): Promise<void> {
  let jobs = await client.syncLibraries(libraries.map((library) => library.id))
  const spinner = createSpinner()
  spinner.start(`正在同步 ${libraries.length} 个文档库`)
  while (jobs.some(isActiveJob)) {
    const progress = jobs.flatMap((job) => (job.progress ? [job.progress] : []))
    const processed = progress.reduce((total, item) => total + item.processed, 0)
    const queued = progress.reduce((total, item) => total + item.queued, 0)
    spinner.message(`任务 ${completedJobs(jobs)}/${jobs.length}，页面 ${processed}/${queued}`)
    await sleep(1_000)
    jobs = await Promise.all(jobs.map((job) => client.getSyncJob(job.id)))
  }
  const failedJobs = jobs.filter((job) => job.status === 'failed')
  const canceledJobs = jobs.filter((job) => job.status === 'canceled')
  const failedPages = jobs.reduce((total, job) => total + job.failures.length, 0)
  if (failedJobs.length) {
    spinner.error('同步失败')
    throw new CliError(`${failedJobs.length} 个文档库同步失败`)
  }
  spinner.stop(`同步完成：${jobs.length - canceledJobs.length}/${jobs.length}`)
  if (failedPages) warning(`${failedPages} 个页面失败，可在同步任务中查看明细`)
  if (canceledJobs.length) warning(`${canceledJobs.length} 个同步任务已取消`)
}

export async function selectLibraries(
  libraries: CloudLibrary[],
  rememberedIds: readonly string[]
): Promise<CloudLibrary[]> {
  if (libraries.length === 0) throw new CliError('Server 还没有文档库')
  const allValue = '__all__'
  const remembered = rememberedIds.filter((id) => libraries.some((library) => library.id === id))
  const initialValues =
    remembered.length === libraries.length && libraries.length > 1
      ? [allValue]
      : remembered.length
        ? remembered
        : libraries.length === 1
          ? [libraries[0]!.id]
          : []
  const ids = await askMultiSelect(
    '请选择要同步的 Server 文档库',
    [
      { value: allValue, label: `全部文档库（${libraries.length} 个）` },
      ...libraries.map((library) => ({
        value: library.id,
        label: library.name,
        hint: `${library.scopePath} · ${library.pages} 页`
      }))
    ],
    initialValues
  )
  if (ids.includes(allValue)) return libraries
  const selected = new Set(ids)
  return libraries.filter((library) => selected.has(library.id))
}

export function isActiveJob(job: CloudSyncJob): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'canceling'
}

function completedJobs(jobs: CloudSyncJob[]): number {
  return jobs.filter((job) => !isActiveJob(job)).length
}
