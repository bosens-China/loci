import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLI_VERSION } from '../apps/cli/src/update.js'
import { createLocalRuntime, startLocalHttpServer } from '../packages/runtime/src/index.js'
import { parseDevDataMode, resolveDevRuntimePaths } from './dev-web-paths.mts'

/** 本地 Web / API 开发端口（固定，与 apps/web/vite.config.ts 默认值一致） */
const WEB_PORT = 12_333
const API_PORT = 12_334

const root = process.cwd()
const dataMode = parseDevDataMode(process.argv.slice(2))
const { dataDir, cacheDir, rootDir } = resolveDevRuntimePaths(root, dataMode)
mkdirSync(rootDir, { recursive: true })

const runtime = createLocalRuntime({
  dataDir,
  cacheDir,
  agentIntegration: {
    packageVersion: CLI_VERSION,
    skillResourceDir: join(root, '.agents/skills/use-loci'),
    homeDir: dataMode === 'isolated' ? join(rootDir, 'home') : undefined
  }
})
const webUrl = `http://127.0.0.1:${WEB_PORT}`
const service = await startLocalHttpServer(runtime, { port: API_PORT, devOrigin: webUrl })
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

const web = spawn(webCommand, webCommandArgs, {
  cwd: root,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  env: { ...process.env, LOCI_DEV_API_PORT: String(service.port) }
})

let closing = false
const close = async (): Promise<void> => {
  if (closing) return
  closing = true
  await stopWeb()
  await service.close()
  await runtime.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
web.once('spawn', () => {
  process.stdout.write(`\nWeb 开发地址：${webUrl}\n`)
  process.stdout.write(`本地 Runtime API：http://127.0.0.1:${service.port}\n`)
  process.stdout.write(`数据模式：${dataMode === 'user' ? '真实用户数据' : '隔离开发数据'}\n`)
  process.stdout.write(`数据目录：${dataDir}\n`)
  if (dataMode === 'user') {
    process.stdout.write(
      '注意：当前为真实用户模式，Web 写操作会直接修改正式 Loci 数据和 Agent 文件。\n'
    )
  }
})

const [code] = (await once(web, 'exit')) as [number | null]
await close()
if (code && code !== 0) process.exitCode = code

async function stopWeb(): Promise<void> {
  if (web.exitCode !== null) return
  if (process.platform !== 'win32' && web.pid) process.kill(-web.pid, 'SIGTERM')
  else web.kill('SIGTERM')
  await Promise.race([
    once(web, 'exit'),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000))
  ])
}
