import { resolveLociDataDir } from './data-path.js'
import { createLocalRuntime, type LocalRuntime, type LocalRuntimeOptions } from './local-runtime.js'
import { startLocalHttpServer, type LocalHttpServer } from './local-http-server.js'
import {
  removeLocalWebServiceState,
  writeLocalWebServiceState,
  type LocalWebServiceState
} from './local-service-state.js'
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js'

export interface LocalService {
  state: LocalWebServiceState
  runtime: LocalRuntime
  http: LocalHttpServer
  close: () => Promise<void>
}

export interface LocalServiceOptions {
  dataDir?: string
  cacheDir?: string
  port?: number
  assetsDir?: string
  startJobWorker?: () => Promise<void>
  ensurePersistentBackground?: () => Promise<void>
  agentIntegration?: LocalRuntimeOptions['agentIntegration']
}

/**
 * 启动只跟随 `loci ui` 生命周期的回环 Web 服务。
 * 抓取任务由独立 worker 执行，因此关闭 Web 不会中止已接受的任务。
 */
export async function startLocalService(options: LocalServiceOptions = {}): Promise<LocalService> {
  const dataDir = options.dataDir ?? resolveLociDataDir()
  const webLock: RuntimeLock = acquireRuntimeLock(dataDir, 'web', 'Loci Web 服务')
  let runtime: LocalRuntime | undefined
  let http: LocalHttpServer | undefined
  let closed = false
  try {
    const createdRuntime = createLocalRuntime({
      dataDir,
      cacheDir: options.cacheDir,
      owner: 'Web UI',
      agentIntegration: options.agentIntegration
    })
    runtime = createdRuntime
    http = await startLocalHttpServer(createdRuntime, {
      port: options.port,
      assetsDir: options.assetsDir,
      startJobWorker: options.startJobWorker,
      ensurePersistentBackground: options.ensurePersistentBackground
    })
    const state: LocalWebServiceState = {
      pid: process.pid,
      port: http.port,
      startedAt: new Date().toISOString()
    }
    writeLocalWebServiceState(dataDir, state)
    return {
      state,
      runtime: createdRuntime,
      http,
      close: async () => {
        if (closed) return
        closed = true
        await http?.close()
        await createdRuntime.close()
        removeLocalWebServiceState(dataDir)
        webLock.release()
      }
    }
  } catch (error) {
    await http?.close()
    await runtime?.close()
    removeLocalWebServiceState(dataDir)
    webLock.release()
    throw error
  }
}
