import type { LociDatabase } from './database-types.js'

export type LocalJobControlAction = 'pause' | 'stop'

/** 任务控制只在页面批次边界抛出，已开始的请求可以安全完成。 */
export class LocalJobControlError extends Error {
  constructor(readonly action: LocalJobControlAction) {
    super(action === 'pause' ? '任务已暂停' : '任务已结束')
    this.name = 'LocalJobControlError'
  }
}

export function assertLocalJobCanContinue(database: LociDatabase, id: string): void {
  const job = database.getLocalJob(id)
  if (!job || job.cancelRequested) return
  if (job.stopRequested) throw new LocalJobControlError('stop')
  if (job.pauseRequested) throw new LocalJobControlError('pause')
}
