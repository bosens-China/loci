import { randomBytes } from 'node:crypto'
import { resolveLociDataDir } from './data-path.js'
import { startLocalHttpServer, type LocalHttpServer } from './local-http-server.js'
import { createLocalJobRunner, type LocalJobRunner } from './local-job-runner.js'
import { createLocalRuntime, type LocalRuntime } from './local-runtime.js'
import {
  removeLocalServiceState,
  writeLocalServiceState,
  type LocalServiceState
} from './local-service-state.js'
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js'

export interface LocalService {
  state: LocalServiceState
  runtime: LocalRuntime
  runner: LocalJobRunner
  http: LocalHttpServer
  close: () => Promise<void>
}

export interface LocalServiceOptions {
  dataDir?: string
  cacheDir?: string
  port?: number
  assetsDir?: string
}

export async function startLocalService(options: LocalServiceOptions = {}): Promise<LocalService> {
  const dataDir = options.dataDir ?? resolveLociDataDir()
  let serviceLock: RuntimeLock | undefined
  let runtime: LocalRuntime | undefined
  let http: LocalHttpServer | undefined
  let runner: LocalJobRunner | undefined
  let cloudTimer: ReturnType<typeof setInterval> | undefined
  let closed = false
  try {
    serviceLock = acquireRuntimeLock(dataDir, 'service', 'Loci 后台服务')
    runtime = createLocalRuntime({
      dataDir,
      cacheDir: options.cacheDir,
      owner: '后台服务'
    })
    let publishJob: LocalHttpServer['publishJob'] = () => undefined
    runner = createLocalJobRunner(runtime, { onJobChange: (job) => publishJob(job) })
    const controlToken = randomBytes(32).toString('base64url')
    http = await startLocalHttpServer(runtime, {
      port: options.port,
      controlToken,
      assetsDir: options.assetsDir,
      runMaintenance: (action) => runner!.runMaintenance(action)
    })
    publishJob = http.publishJob
    const state: LocalServiceState = {
      pid: process.pid,
      port: http.port,
      controlToken,
      startedAt: new Date().toISOString()
    }
    writeLocalServiceState(dataDir, state)
    runner.start()
    const syncCloudCopies = (): void => {
      const serverUrl = runtime?.database.getSettings().serverUrl
      if (serverUrl) void runtime?.cloud.syncEligible(serverUrl)
    }
    syncCloudCopies()
    cloudTimer = setInterval(syncCloudCopies, 24 * 60 * 60 * 1_000)
    cloudTimer.unref?.()
    return {
      state,
      runtime,
      runner,
      http,
      close: async () => {
        if (closed) return
        closed = true
        if (cloudTimer) clearInterval(cloudTimer)
        await runner?.stop()
        await http?.close()
        await runtime?.close()
        removeLocalServiceState(dataDir)
        serviceLock?.release()
      }
    }
  } catch (error) {
    if (cloudTimer) clearInterval(cloudTimer)
    await runner?.stop()
    await http?.close()
    await runtime?.close()
    serviceLock?.release()
    throw error
  }
}
