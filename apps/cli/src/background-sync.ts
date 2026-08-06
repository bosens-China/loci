import { spawn } from 'node:child_process'

/** 显式后台同步使用一次性子进程，完成后自然退出，不创建长期守护进程。 */
export async function startBackgroundSourceSync(sourceId: string): Promise<void> {
  const entry = process.argv[1]
  if (!entry) throw new Error('无法定位 Loci CLI 入口，不能启动后台同步')
  const child = spawn(process.execPath, [entry, 'source', 'sync', sourceId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}
