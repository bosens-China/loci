import { type ChildProcess, spawn } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

/** 本机开发时由 dev-web 管理的 Hono Server 地址。 */
export const DEV_CLOUD_SERVER_PORT = 7_001
export const DEV_CLOUD_SERVER_URL = `http://127.0.0.1:${DEV_CLOUD_SERVER_PORT}`
export const DEV_CLOUD_SERVER_PASSWORD = 'loci-local-admin-password'

type Environment = Record<string, string | undefined>

export type DevCloudServer = {
  child: ChildProcess | null
  managed: boolean
  owned: boolean
}

type DevCloudServerState = {
  pid: number
  startedAt: string
}

type EnsureDevCloudServerOptions = {
  environment: Environment
  root: string
  serverUrl: string
  sessionId: number
}

/** 判断当前 Runtime 是否应连接由开发脚本管理的本机 Server。 */
export function usesManagedDevCloudServer(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return (
      url.protocol === 'http:' &&
      port === DEV_CLOUD_SERVER_PORT &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

/** 为隔离开发 Server 构造环境，dev:user 也不复用生产 Server 的 SQLite 数据。 */
export function createDevCloudServerEnvironment(root: string, parent: Environment): Environment {
  return {
    ...parent,
    PORT: String(DEV_CLOUD_SERVER_PORT),
    LOCI_DATA_DIR: join(root, '.loci-dev', 'server-data'),
    LOCI_ADMIN_USERNAME: 'admin',
    LOCI_ADMIN_PASSWORD: parent.LOCI_LOCAL_ADMIN_PASSWORD?.trim() || DEV_CLOUD_SERVER_PASSWORD
  }
}

/** 启动或复用开发 Hono Server，并登记当前 dev/dev:user 会话。 */
export async function ensureDevCloudServer(
  options: EnsureDevCloudServerOptions
): Promise<DevCloudServer> {
  if (!usesManagedDevCloudServer(options.serverUrl)) {
    return { child: null, managed: false, owned: false }
  }

  const lock = await acquireServerLock(options.root)
  try {
    removeStaleSessions(options.root)
    const state = readServerState(options.root)
    if (await isServerHealthy()) {
      if (!state || !isProcessRunning(state.pid)) {
        removeServerState(options.root)
        return { child: null, managed: false, owned: false }
      }
      registerSession(options.root, options.sessionId)
      return { child: null, managed: true, owned: false }
    }

    if (state && isProcessRunning(state.pid)) {
      if (listSessions(options.root).length > 0) {
        throw new Error('云端开发后端未通过健康检查，请先结束已有开发会话')
      }
      await stopProcessGroup(state.pid)
    }
    removeServerState(options.root)

    const args = ['--filter', '@loci/server', 'dev']
    const command =
      process.platform === 'win32' ? (options.environment.ComSpec ?? 'cmd.exe') : 'pnpm'
    const commandArgs =
      process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args
    const child = spawn(command, commandArgs, {
      cwd: options.root,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: createDevCloudServerEnvironment(options.root, options.environment)
    })
    await waitForServer(child)
    if (!child.pid) throw new Error('无法获取云端开发后端进程 ID')
    writeServerState(options.root, { pid: child.pid, startedAt: new Date().toISOString() })
    registerSession(options.root, options.sessionId)
    return { child, managed: true, owned: true }
  } finally {
    releaseServerLock(options.root, lock)
  }
}

/** 退出时移除当前会话；最后一个会话负责关闭自动启动的 Server。 */
export async function releaseDevCloudServer(root: string, sessionId: number): Promise<void> {
  const lock = await acquireServerLock(root)
  try {
    rmSync(sessionPath(root, sessionId), { force: true })
    removeStaleSessions(root)
    if (listSessions(root).length > 0) return

    const state = readServerState(root)
    removeServerState(root)
    if (state && isProcessRunning(state.pid)) await stopProcessGroup(state.pid)
  } finally {
    releaseServerLock(root, lock)
  }
}

async function acquireServerLock(root: string): Promise<number> {
  const directory = serverDirectory(root)
  mkdirSync(directory, { recursive: true })
  const lockPath = join(directory, 'server-start.lock')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const descriptor = openSync(lockPath, 'wx')
      writeFileSync(descriptor, String(process.pid))
      return descriptor
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') throw error
      if (isLockStale(lockPath)) rmSync(lockPath, { force: true })
      else await sleep(100)
    }
  }
  throw new Error('等待另一个开发会话处理云端后端超时')
}

function releaseServerLock(root: string, descriptor: number): void {
  closeSync(descriptor)
  rmSync(join(serverDirectory(root), 'server-start.lock'), { force: true })
}

function isLockStale(lockPath: string): boolean {
  try {
    return !isProcessRunning(Number(readFileSync(lockPath, 'utf8')))
  } catch (error) {
    return getErrorCode(error) === 'ENOENT'
  }
}

function registerSession(root: string, sessionId: number): void {
  const directory = sessionsDirectory(root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(sessionPath(root, sessionId), new Date().toISOString())
}

function removeStaleSessions(root: string): void {
  const directory = sessionsDirectory(root)
  if (!isDirectoryReadable(directory)) return
  for (const file of readdirSync(directory)) {
    const pid = Number(file)
    if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessRunning(pid)) {
      rmSync(join(directory, file), { force: true })
    }
  }
}

function listSessions(root: string): number[] {
  const directory = sessionsDirectory(root)
  if (!isDirectoryReadable(directory)) return []
  return readdirSync(directory)
    .map(Number)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0 && isProcessRunning(pid))
}

function readServerState(root: string): DevCloudServerState | null {
  try {
    const value: unknown = JSON.parse(readFileSync(serverStatePath(root), 'utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('pid' in value) ||
      !('startedAt' in value)
    ) {
      return null
    }
    const { pid, startedAt } = value
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || typeof startedAt !== 'string') {
      return null
    }
    return { pid, startedAt }
  } catch {
    return null
  }
}

function writeServerState(root: string, state: DevCloudServerState): void {
  writeFileSync(serverStatePath(root), JSON.stringify(state))
}

function removeServerState(root: string): void {
  rmSync(serverStatePath(root), { force: true })
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isServerHealthy()) return
    if (child.exitCode !== null) {
      throw new Error(`云端开发后端启动失败（退出码 ${child.exitCode}）`)
    }
    await sleep(100)
  }
  await stopChild(child)
  throw new Error('等待云端开发后端健康检查超时')
}

async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${DEV_CLOUD_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(500)
    })
    if (!response.ok) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await stopProcessGroup(child.pid)
}

async function stopProcessGroup(pid: number | undefined): Promise<void> {
  if (!pid || !isProcessRunning(pid)) return
  try {
    if (process.platform !== 'win32') process.kill(-pid, 'SIGTERM')
    else process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (getErrorCode(error) !== 'ESRCH') throw error
  }
  const deadline = Date.now() + 3_000
  while (isProcessRunning(pid) && Date.now() < deadline) await sleep(100)
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return getErrorCode(error) !== 'ESRCH'
  }
}

function serverDirectory(root: string): string {
  return join(root, '.loci-dev')
}

function sessionsDirectory(root: string): string {
  return join(serverDirectory(root), 'server-sessions')
}

function sessionPath(root: string, sessionId: number): string {
  return join(sessionsDirectory(root), String(sessionId))
}

function serverStatePath(root: string): string {
  return join(serverDirectory(root), 'server.json')
}

function isDirectoryReadable(path: string): boolean {
  try {
    readdirSync(path)
    return true
  } catch {
    return false
  }
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
