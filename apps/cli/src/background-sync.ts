import { ensurePersistentBackgroundService } from './background-host.js'
import { createCliRuntime } from './runtime.js'

/** 显式后台同步提交持久任务；默认数据目录由登录服务执行。 */
export async function startBackgroundSourceSync(sourceId: string): Promise<void> {
  await ensurePersistentBackgroundService()

  const runtime = createCliRuntime()
  try {
    runtime.database.enqueueSourceSync(sourceId, 'background')
  } finally {
    await runtime.close()
  }
}
