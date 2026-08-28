import { createLocalJobRunner, type LocalJobRunner } from './local-job-runner.js'
import { createLocalRuntime, type LocalRuntime, type LocalRuntimeOptions } from './local-runtime.js'
import { resolveLociDataDir } from './data-path.js'
import {
  removeLocalServiceState,
  writeLocalServiceState,
  type LocalServiceState
} from './local-service-state.js'
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js'

export interface LocalWorker {
  state: LocalServiceState
  runtime: LocalRuntime
  runner: LocalJobRunner
  start: () => void
  runUntilIdle: () => Promise<void>
  close: () => Promise<void>
}

export interface LocalWorkerOptions {
  dataDir?: string
  cacheDir?: string
  defaultServerUrl?: LocalRuntimeOptions['defaultServerUrl']
  idleMs?: number
  heartbeatMs?: number
  mode?: LocalServiceState['mode']
}

/** 无 HTTP 的后台 worker；同一数据目录只允许一个进程认领本地任务队列。 */
export function startLocalWorker(options: LocalWorkerOptions = {}): LocalWorker {
  const dataDir = options.dataDir ?? resolveLociDataDir()
  const workerLock: RuntimeLock = acquireRuntimeLock(dataDir, 'worker', 'Loci 后台 worker')
  let runtime: LocalRuntime | undefined
  let runner: LocalJobRunner | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let cloudTimer: ReturnType<typeof setInterval> | undefined
  let closed = false
  try {
    const createdRuntime = createLocalRuntime({
      dataDir,
      cacheDir: options.cacheDir,
      defaultServerUrl: options.defaultServerUrl,
      owner: '后台 worker'
    })
    runtime = createdRuntime
    runner = createLocalJobRunner(createdRuntime)
    const startedAt = new Date().toISOString()
    const mode = options.mode ?? 'on-demand'
    const writeState = (): LocalServiceState => {
      const state = { pid: process.pid, mode, startedAt, heartbeatAt: new Date().toISOString() }
      writeLocalServiceState(createdRuntime.dataDir, state)
      return state
    }
    const state = writeState()
    heartbeat = setInterval(writeState, Math.max(500, options.heartbeatMs ?? 2_000))
    heartbeat.unref?.()

    const syncCloudCopies = (): void => {
      const serverUrl = createdRuntime.database.getSettings().serverUrl
      if (serverUrl) void createdRuntime.cloud.syncEligible(serverUrl)
    }
    const start = (): void => {
      runner?.start()
      syncCloudCopies()
      if (!cloudTimer) {
        cloudTimer = setInterval(syncCloudCopies, 24 * 60 * 60 * 1_000)
        cloudTimer.unref?.()
      }
    }
    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (cloudTimer) clearInterval(cloudTimer)
      await runner?.stop()
      await createdRuntime.close()
      removeLocalServiceState(dataDir)
      workerLock.release()
    }
    return {
      state,
      runtime: createdRuntime,
      runner,
      start,
      runUntilIdle: () => runUntilIdle(runner!, options.idleMs ?? 750),
      close
    }
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat)
    if (cloudTimer) clearInterval(cloudTimer)
    void runner?.stop()
    void runtime?.close()
    workerLock.release()
    throw error
  }
}

async function runUntilIdle(runner: LocalJobRunner, idleMs: number): Promise<void> {
  let idleSince: number | undefined
  while (true) {
    const claimed = await runner.runOnce()
    if (claimed > 0 || runner.activeCount() > 0) idleSince = undefined
    else idleSince ??= Date.now()
    if (idleSince && Date.now() - idleSince >= idleMs) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
}
