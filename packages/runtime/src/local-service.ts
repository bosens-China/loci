import { randomBytes } from 'node:crypto'
import { resolveLociDataDir } from './data-path.js'
import { startLocalHttpServer, type LocalHttpServer } from './local-http-server.js'
import { createLocalJobRunner, type LocalJobRunner } from './local-job-runner.js'
import { createLocalMcpServices } from './local-mcp-services.js'
import { createLocalRuntime, type LocalRuntime } from './local-runtime.js'
import { isLociMcpAvailable, startMcpHttpServer, type McpHttpServer } from './mcp/http.js'
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
  mcp: McpHttpServer | null
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
  let mcp: McpHttpServer | undefined
  let cloudTimer: ReturnType<typeof setInterval> | undefined
  const closing = new AbortController()
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
    const mcpPort = runtime.database.getSettings().mcpPort
    if (!(await isLociMcpAvailable(mcpPort))) {
      try {
        mcp = await startMcpHttpServer(
          mcpPort,
          createLocalMcpServices(runtime, { durableJobs: true, signal: closing.signal })
        )
      } catch (error) {
        console.error(`后台服务无法监听 MCP 端口 ${mcpPort}`, error)
      }
    }
    const state: LocalServiceState = {
      pid: process.pid,
      port: http.port,
      mcpPort,
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
      mcp: mcp ?? null,
      close: async () => {
        if (closed) return
        closed = true
        closing.abort(new Error('后台服务正在停止'))
        if (cloudTimer) clearInterval(cloudTimer)
        await mcp?.close()
        await runner?.stop()
        await http?.close()
        await runtime?.close()
        removeLocalServiceState(dataDir)
        serviceLock?.release()
      }
    }
  } catch (error) {
    closing.abort(error)
    if (cloudTimer) clearInterval(cloudTimer)
    await runner?.stop()
    await mcp?.close()
    await http?.close()
    await runtime?.close()
    serviceLock?.release()
    throw error
  }
}
