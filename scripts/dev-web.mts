import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkLocalService,
  createLocalWebSession,
  readLocalServiceState,
  RuntimeLockedError,
  startLocalService,
  type LocalService,
  type LocalServiceState
} from '../packages/runtime/src/index.js'

/** 本地 Web / API 开发端口（固定，与 apps/web/vite.config.ts 默认值一致） */
const WEB_PORT = 12_333
const API_PORT = 12_334

const root = process.cwd()
const devRoot = join(root, '.loci-dev')
const dataDir = join(devRoot, 'data')
const cacheDir = join(devRoot, 'cache')
mkdirSync(devRoot, { recursive: true })

const { service, state, owned } = await ensureDevService()
const token = await createLocalWebSession(state)
const webUrl = `http://127.0.0.1:${WEB_PORT}/#token=${encodeURIComponent(token)}`

const web = spawn(
  'pnpm',
  [
    '--filter',
    '@loci/web',
    'dev',
    '--host',
    '127.0.0.1',
    '--port',
    String(WEB_PORT),
    '--strictPort'
  ],
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
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
web.once('spawn', () => {
  process.stdout.write(`\nLoci Web 开发地址：${webUrl}\n`)
  process.stdout.write(`本地 API：http://127.0.0.1:${state.port}\n`)
  if (!owned) {
    process.stdout.write('已复用正在运行的开发服务（仅启动 Vite）。\n')
  }
})

const [code] = (await once(web, 'exit')) as [number | null]
await close()
if (code && code !== 0) process.exitCode = code

/** 启动或复用 .loci-dev 下的本地服务，避免重复 pnpm dev 时锁冲突。 */
async function ensureDevService(): Promise<{
  service: LocalService | null
  state: LocalServiceState
  owned: boolean
}> {
  const existing = readLocalServiceState(dataDir)
  if (existing && (await checkLocalService(existing))) {
    return { service: null, state: existing, owned: false }
  }

  try {
    const started = await startLocalService({ dataDir, cacheDir, port: API_PORT })
    return { service: started, state: started.state, owned: true }
  } catch (error) {
    if (!(error instanceof RuntimeLockedError)) throw error

    const locked = readLocalServiceState(dataDir)
    if (locked && (await checkLocalService(locked))) {
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
