import type { LocalJob } from '@loci/shared'
import type { LocalJobDatabase } from './local-job-database.js'
import type { OperationLogDatabase } from './operation-log-database.js'

/** 在领域状态变更成功后写结构化日志，所有入口复用同一包装层。 */
export function createLoggedLocalJobDatabase(
  jobs: LocalJobDatabase,
  logs: OperationLogDatabase
): LocalJobDatabase {
  const recordJob = (action: string, job: LocalJob, message: string): void => {
    logs.recordOperationLog({
      category: 'task',
      action,
      level: job.status === 'failed' ? 'error' : 'info',
      resourceType: 'local_job',
      resourceId: job.id,
      hostname: job.hostname,
      message,
      details: { sourceId: job.sourceId, status: job.status, partial: job.partial }
    })
  }
  return {
    ...jobs,
    enqueueSourceSync: (...args) => {
      const result = jobs.enqueueSourceSync(...args)
      if (!result.reused) recordJob('enqueue', result.job, '后台任务已提交')
      return result
    },
    claimNextLocalJob: (...args) => {
      const job = jobs.claimNextLocalJob(...args)
      if (job) recordJob('claim', job, '调度器已领取后台任务')
      return job
    },
    completeLocalJob: (...args) => {
      const changed = jobs.completeLocalJob(...args)
      recordAfter(changed, args[0], 'complete', '后台任务已完成', jobs, recordJob)
      return changed
    },
    failLocalJob: (...args) => {
      const changed = jobs.failLocalJob(...args)
      recordAfter(changed, args[0], 'fail', args[2], jobs, recordJob)
      return changed
    },
    requestLocalJobCancellation: (id) => {
      const job = jobs.requestLocalJobCancellation(id)
      if (job) recordJob('cancel', job, '用户请求取消并丢弃本次内容')
      return job
    },
    requestLocalJobPause: (id) => {
      const job = jobs.requestLocalJobPause(id)
      if (job) recordJob('pause', job, '用户请求暂停任务')
      return job
    },
    resumeLocalJob: (id) => {
      const job = jobs.resumeLocalJob(id)
      if (job) recordJob('resume', job, '用户恢复未完结任务')
      return job
    },
    requestLocalJobStop: (id) => {
      const job = jobs.requestLocalJobStop(id)
      if (job) recordJob('stop', job, '用户结束任务并保留已抓取内容')
      return job
    },
    setLocalJobPriority: (id, priority) => {
      const job = jobs.setLocalJobPriority(id, priority)
      if (job) recordJob('priority', job, `任务优先级已调整为 ${job.priority}`)
      return job
    },
    pauseLocalJobs: (hostname) => {
      const changed = jobs.pauseLocalJobs(hostname)
      recordBulk(logs, 'pause_all', hostname, changed)
      return changed
    },
    resumeLocalJobs: (hostname) => {
      const changed = jobs.resumeLocalJobs(hostname)
      recordBulk(logs, 'resume_all', hostname, changed)
      return changed
    },
    releasePausedLocalJob: (id, owner) => {
      const changed = jobs.releasePausedLocalJob(id, owner)
      recordAfter(changed, id, 'paused', '后台任务已安全暂停', jobs, recordJob)
      return changed
    },
    completePartialLocalJob: (...args) => {
      const changed = jobs.completePartialLocalJob(...args)
      recordAfter(changed, args[0], 'partial', '任务已结束并保留部分内容', jobs, recordJob)
      return changed
    }
  }
}

function recordAfter(
  changed: boolean,
  id: string,
  action: string,
  message: string,
  jobs: LocalJobDatabase,
  record: (action: string, job: LocalJob, message: string) => void
): void {
  if (!changed) return
  const job = jobs.getLocalJob(id)
  if (job) record(action, job, message)
}

function recordBulk(
  logs: OperationLogDatabase,
  action: string,
  hostname: string | undefined,
  changed: number
): void {
  logs.recordOperationLog({
    category: 'task',
    action,
    level: 'info',
    resourceType: 'hostname',
    resourceId: hostname ?? null,
    hostname: hostname ?? null,
    message: `批量任务控制已影响 ${changed} 个任务`,
    details: { changed }
  })
}
