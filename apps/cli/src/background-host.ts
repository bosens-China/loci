import { ensureLocalServiceRunning } from './service-manager.js'

/** 开启持久后台能力前保证宿主可用，并给出可执行的故障恢复提示。 */
export async function ensurePersistentBackgroundService(
  ensureService: () => Promise<unknown> = ensureLocalServiceRunning
): Promise<void> {
  try {
    await ensureService()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    throw new Error(
      `无法启动 Loci 后台服务：${message}。请运行 loci service start；仍失败时运行 loci service logs 查看日志。`
    )
  }
}

/** 只在开启持久能力时先激活宿主；关闭操作直接保存，不干扰其他后台需求。 */
export async function applyPersistentBackgroundSetting<T>(
  enabled: boolean,
  action: () => T | Promise<T>,
  ensureService: () => Promise<unknown> = ensureLocalServiceRunning
): Promise<T> {
  if (enabled) await ensurePersistentBackgroundService(ensureService)
  return action()
}
