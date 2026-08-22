import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import {
  checkLocalWebService,
  readLocalWebServiceState,
  RuntimeLockedError,
  startLocalService,
  startLocalWorker,
  type LocalService,
  type LocalWebServiceState,
  type LocalWorker
} from '../packages/runtime/src/index.js'
import { parseDevDataMode, resolveDevRuntimePaths } from './dev-web-paths.mts'

/** 本地 Web / API 开发端口（固定，与 apps/web/vite.config.ts 默认值一致） */
const WEB_PORT = 12_333
const API_PORT = 12_334

const root = process.cwd()
const dataMode = parseDevDataMode(process.argv.slice(2))
const { dataDir, cacheDir, rootDir } = resolveDevRuntimePaths(root, dataMode)
mkdirSync(rootDir, { recursive: true })

let worker: LocalWorker | null = null
let keepWorker = false

const { service, state, owned } = await ensureDevService()
const webUrl = `http://127.0.0.1:${WEB_PORT}/`
const webArgs = [
  '--filter',
  '@loci/web',
  'dev',
  '--host',
  '127.0.0.1',
  '--port',
  String(WEB_PORT),
  '--strictPort'
]
const webCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const webCommandArgs =
  process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${webArgs.join(' ')}`] : webArgs

const web = spawn(
  webCommand,
  webCommandArgs,
  {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, LOCI_DEV_API_PORT: String(state.port) }
  }
)

let closing = false
const close = async (): Promise<void> => {
  if (closing) return
  closing = true
  if (web.exitCode === null) {
    if (process.platform !== 'win32' && web.pid) process.kill(-web.pid, 'SIGTERM')
    else web.kill('SIGTERM')
  }
  if (owned) await service?.close()
  await worker?.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
web.once('spawn', () => {
  process.stdout.write(`\nLoci Web 开发地址：${webUrl}\n`)
  process.stdout.write(`本地 API：http://127.0.0.1:${state.port}\n`)
  process.stdout.write(`数据目录：${dataDir}\n`)
  if (dataMode === 'user') {
    process.stdout.write('注意：当前为真实用户数据模式，Web 中的写操作会直接修改正式 Loci 数据。\n')
  }
  if (!owned) {
    process.stdout.write('已复用正在运行的开发服务（仅启动 Vite）。\n')
  }
})

const [code] = (await once(web, 'exit')) as [number | null]
await close()
if (code && code !== 0) process.exitCode = code

/** 启动或复用当前数据模式下的本地服务，避免重复启动时锁冲突。 */
async function ensureDevService(): Promise<{
  service: LocalService | null
  state: LocalWebServiceState
  owned: boolean
}> {
  const existing = readLocalWebServiceState(dataDir)
  if (existing && (await checkLocalWebService(existing))) {
    return { service: null, state: existing, owned: false }
  }

  try {
    const started = await startLocalService({
      dataDir,
      cacheDir,
      port: API_PORT,
      startJobWorker: () => ensureDevWorker(false),
      ensurePersistentBackground: () => ensureDevWorker(true)
    })
    return { service: started, state: started.state, owned: true }
  } catch (error) {
    if (!(error instanceof RuntimeLockedError)) throw error

    const locked = readLocalWebServiceState(dataDir)
    if (locked && (await checkLocalWebService(locked))) {
      return { service: null, state: locked, owned: false }
    }

    const pid = error.record?.pid
    process.stderr.write(
      `\n无法启动开发服务：${error.message}\n` +
        (pid
          ? `请先结束占用进程，例如：kill ${pid}\n` +
            `若这是用户级后台服务且 LOCI_DATA_DIR 指向 .loci-dev，请先运行：loci service stop\n`
          : '')
    )
    process.exit(1)
  }
}

async function ensureDevWorker(persistent: boolean): Promise<void> {
  if (persistent) keepWorker = true
  if (worker) {
    if (persistent) worker.start()
    return
  }
  worker = startLocalWorker({ dataDir, cacheDir, mode: persistent ? 'persistent' : 'on-demand' })
  if (persistent) {
    worker.start()
    return
  }
  const current = worker
  void current.runUntilIdle().finally(async () => {
    if (keepWorker) return
    await current.close()
    if (worker === current) worker = null
  })
}
