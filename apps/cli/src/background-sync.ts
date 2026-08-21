import { createCliRuntime } from './runtime.js'
import { ensureLocalJobWorkerRunning } from './service-manager.js'

/** 显式后台同步提交持久任务；默认数据目录由登录服务执行。 */
export async function startBackgroundSourceSync(sourceId: string): Promise<void> {
  const runtime = createCliRuntime()
  try {
    runtime.database.enqueueSourceSync(sourceId, 'background')
  } finally {
    await runtime.close()
  }
  await ensureLocalJobWorkerRunning()
}
