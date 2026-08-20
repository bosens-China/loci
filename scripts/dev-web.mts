import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createLocalWebSession, startLocalService } from '../packages/runtime/src/index.js'

const root = process.cwd()
const devRoot = join(root, '.loci-dev')
mkdirSync(devRoot, { recursive: true })

const service = await startLocalService({
  dataDir: join(devRoot, 'data'),
  cacheDir: join(devRoot, 'cache'),
  port: 37374
})
const token = await createLocalWebSession(service.state)
const web = spawn(
  'pnpm',
  ['--filter', '@loci/web', 'dev', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' }
)

let closing = false
const close = async (): Promise<void> => {
  if (closing) return
  closing = true
  if (web.exitCode === null) {
    if (process.platform !== 'win32' && web.pid) process.kill(-web.pid, 'SIGTERM')
    else web.kill('SIGTERM')
  }
  await service.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
web.once('spawn', () => {
  process.stdout.write(
    `\nLoci Web 开发地址：http://127.0.0.1:5173/#token=${encodeURIComponent(token)}\n`
  )
})

const [code] = (await once(web, 'exit')) as [number | null]
await close()
if (code && code !== 0) process.exitCode = code
