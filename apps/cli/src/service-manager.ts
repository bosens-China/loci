import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkLocalService,
  acquireRuntimeLock,
  readLocalServiceState,
  resolveLociDataDir,
  RuntimeLockedError,
  writeFileAtomically,
  type LocalServiceState
} from '@loci/runtime'
import {
  LOCI_SERVICE_LABEL,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsServiceScript,
  type ServiceCommand
} from './service-definition.js'

export {
  LOCI_SERVICE_LABEL,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsServiceScript,
  type ServiceCommand
} from './service-definition.js'

export interface ServiceStatus {
  installed: boolean
  running: boolean
  state: LocalServiceState | null
  definitionPath: string
  logPaths: string[]
}

export interface UserServiceManager {
  install: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  disable: () => Promise<void>
  status: () => Promise<ServiceStatus>
  definitionPath: string
  logPaths: string[]
}

const activeServiceStarts = new Map<string, Promise<LocalServiceState>>()
const activeWorkerStarts = new Map<string, Promise<LocalServiceState>>()
export function resolveServiceCommand(): ServiceCommand {
  const entry = process.argv[1]
  if (!entry) throw new Error('无法定位 Loci CLI 入口，不能注册后台服务')
  return {
    executable: process.execPath,
    args: [entry, 'service', 'run', '--managed'],
    environment: Object.fromEntries(
      [
        ['LOCI_DATA_DIR', process.env.LOCI_DATA_DIR?.trim()],
        ['LOCI_CACHE_DIR', process.env.LOCI_CACHE_DIR?.trim()],
        ['LOCI_SERVER_URL', process.env.LOCI_SERVER_URL?.trim()]
      ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    )
  }
}

export function createUserServiceManager(
  command = resolveServiceCommand(),
  dataDir = resolveLociDataDir(),
  platform = process.platform,
  userHome = homedir()
): UserServiceManager {
  if (platform === 'darwin') return createLaunchdManager(command, dataDir, userHome)
  if (platform === 'linux') return createSystemdManager(command, dataDir, userHome)
  if (platform === 'win32') return createTaskSchedulerManager(command, dataDir)
  throw new Error(`当前平台 ${platform} 不支持 Loci 后台服务`)
}

export function ensureUserServiceRunning(
  manager = createUserServiceManager(),
  dataDir = resolveLociDataDir(),
  waitForService = waitForUserService
): Promise<LocalServiceState> {
  return runServiceStartSingleFlight(dataDir, () =>
    withServiceStartLock(dataDir, waitForService, async () => {
      const status = await manager.status()
      if (status.running && status.state?.mode === 'persistent') return status.state
      if (!status.installed) await manager.install()
      else await manager.start()
      if (status.running && status.state?.mode === 'on-demand') return status.state
      return waitForService(dataDir)
    })
  )
}

/** 自定义数据目录不污染登录服务定义，只为当前环境启动独立后台进程。 */
export function ensureLocalServiceRunning(): Promise<LocalServiceState> {
  if (!process.env.LOCI_DATA_DIR?.trim()) return ensureUserServiceRunning()
  const dataDir = resolveLociDataDir()
  return runServiceStartSingleFlight(dataDir, () =>
    withServiceStartLock(dataDir, waitForUserService, async () => {
      const existing = readLocalServiceState(dataDir)
      if (existing?.mode === 'persistent' && (await checkLocalService(existing))) return existing
      const entry = process.argv[1]
      if (!entry) throw new Error('无法定位 Loci CLI 入口，不能启动后台服务')
      const child = spawn(process.execPath, [entry, 'service', 'run', '--managed'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: process.env
      })
      await new Promise<void>((resolvePromise, reject) => {
        child.once('spawn', resolvePromise)
        child.once('error', reject)
      })
      child.unref()
      if (existing?.mode === 'on-demand' && (await checkLocalService(existing))) return existing
      return waitForUserService(dataDir)
    })
  )
}

/** 启动队列空闲后自动退出的无 HTTP worker，不安装登录自启动服务。 */
export function ensureLocalJobWorkerRunning(
  dataDir = resolveLociDataDir(),
  spawnWorker: () => Promise<void> = spawnLocalJobWorker,
  waitForWorker: (dataDir: string) => Promise<LocalServiceState> = waitForLocalWorker
): Promise<LocalServiceState> {
  return runStartSingleFlight(activeWorkerStarts, dataDir, () =>
    withStartLock(dataDir, 'worker-start', 'Loci 任务 worker 激活', waitForWorker, async () => {
      const existing = readLocalServiceState(dataDir)
      if (existing && (await checkLocalService(existing))) return existing
      await spawnWorker()
      return waitForWorker(dataDir)
    })
  )
}

function runServiceStartSingleFlight(
  dataDir: string,
  start: () => Promise<LocalServiceState>
): Promise<LocalServiceState> {
  return runStartSingleFlight(activeServiceStarts, dataDir, start)
}

function runStartSingleFlight(
  activeStarts: Map<string, Promise<LocalServiceState>>,
  dataDir: string,
  start: () => Promise<LocalServiceState>
): Promise<LocalServiceState> {
  const active = activeStarts.get(dataDir)
  if (active) return active
  const task = start()
  activeStarts.set(dataDir, task)
  const cleanup = (): void => {
    if (activeStarts.get(dataDir) === task) activeStarts.delete(dataDir)
  }
  void task.then(cleanup, cleanup)
  return task
}

async function withServiceStartLock(
  dataDir: string,
  waitForService: (dataDir: string) => Promise<LocalServiceState>,
  start: () => Promise<LocalServiceState>
): Promise<LocalServiceState> {
  return withStartLock(dataDir, 'service-start', 'Loci 后台服务激活', waitForService, start)
}

async function withStartLock(
  dataDir: string,
  lockKey: string,
  owner: string,
  waitForResult: (dataDir: string) => Promise<LocalServiceState>,
  start: () => Promise<LocalServiceState>
): Promise<LocalServiceState> {
  let lock: ReturnType<typeof acquireRuntimeLock>
  try {
    lock = acquireRuntimeLock(dataDir, lockKey, owner)
  } catch (error) {
    if (error instanceof RuntimeLockedError) return waitForResult(dataDir)
    throw error
  }
  try {
    return await start()
  } finally {
    lock.release()
  }
}

export async function waitForUserService(
  dataDir = resolveLociDataDir(),
  timeoutMs = 12_000
): Promise<LocalServiceState> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = readLocalServiceState(dataDir)
    if (state?.mode === 'persistent' && (await checkLocalService(state))) return state
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  }
  throw new Error('Loci 后台服务启动超时，请运行 loci service logs 查看日志')
}

export async function waitForLocalWorker(
  dataDir = resolveLociDataDir(),
  timeoutMs = 12_000
): Promise<LocalServiceState> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = readLocalServiceState(dataDir)
    if (state && (await checkLocalService(state))) return state
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  }
  throw new Error('Loci 任务 worker 启动超时')
}

async function spawnLocalJobWorker(): Promise<void> {
  const entry = process.argv[1]
  if (!entry) throw new Error('无法定位 Loci CLI 入口，不能启动任务 worker')
  const child = spawn(process.execPath, [entry, 'service', 'worker'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env
  })
  await new Promise<void>((resolvePromise, reject) => {
    child.once('spawn', resolvePromise)
    child.once('error', reject)
  })
  child.unref()
}

function createLaunchdManager(
  command: ServiceCommand,
  dataDir: string,
  userHome: string
): UserServiceManager {
  const definitionPath = join(userHome, 'Library', 'LaunchAgents', `${LOCI_SERVICE_LABEL}.plist`)
  const domain = `gui/${process.getuid?.() ?? 0}`
  const target = `${domain}/${LOCI_SERVICE_LABEL}`
  const logPaths = [
    join(dataDir, 'logs', 'service.log'),
    join(dataDir, 'logs', 'service-error.log')
  ]
  const loaded = async (): Promise<boolean> =>
    (await run('launchctl', ['print', target], true)).code === 0
  const bootstrap = async (): Promise<void> => {
    if (!(await loaded())) await runOrThrow('launchctl', ['bootstrap', domain, definitionPath])
    await runOrThrow('launchctl', ['enable', target])
    await runOrThrow('launchctl', ['kickstart', target])
  }
  return {
    definitionPath,
    logPaths,
    install: async () => {
      mkdirSync(dirname(definitionPath), { recursive: true })
      mkdirSync(join(dataDir, 'logs'), { recursive: true })
      if (await loaded()) await runOrThrow('launchctl', ['bootout', target])
      writeFileAtomically(definitionPath, renderLaunchdPlist(command, dataDir))
      await bootstrap()
    },
    start: async () => {
      if (!existsSync(definitionPath)) throw new Error('Loci 后台服务尚未安装')
      await bootstrap()
    },
    stop: async () => {
      if (await loaded()) await runOrThrow('launchctl', ['bootout', target])
    },
    restart: async () => {
      if (await loaded()) await runOrThrow('launchctl', ['bootout', target])
      await bootstrap()
    },
    disable: async () => {
      if (await loaded()) await runOrThrow('launchctl', ['bootout', target])
      rmSync(definitionPath, { force: true })
    },
    status: () => serviceStatus(dataDir, definitionPath, logPaths)
  }
}

function createSystemdManager(
  command: ServiceCommand,
  dataDir: string,
  userHome: string
): UserServiceManager {
  const definitionPath = join(userHome, '.config', 'systemd', 'user', 'loci.service')
  const logPaths = [
    join(dataDir, 'logs', 'service.log'),
    join(dataDir, 'logs', 'service-error.log')
  ]
  return {
    definitionPath,
    logPaths,
    install: async () => {
      mkdirSync(dirname(definitionPath), { recursive: true })
      mkdirSync(join(dataDir, 'logs'), { recursive: true })
      writeFileAtomically(definitionPath, renderSystemdUnit(command, dataDir))
      await runOrThrow('systemctl', ['--user', 'daemon-reload'])
      await runOrThrow('systemctl', ['--user', 'enable', '--now', 'loci.service'])
    },
    start: async () => runOrThrow('systemctl', ['--user', 'start', 'loci.service']),
    stop: async () => runOrThrow('systemctl', ['--user', 'stop', 'loci.service']),
    restart: async () => runOrThrow('systemctl', ['--user', 'restart', 'loci.service']),
    disable: async () => {
      await run('systemctl', ['--user', 'disable', '--now', 'loci.service'], true)
      rmSync(definitionPath, { force: true })
      await runOrThrow('systemctl', ['--user', 'daemon-reload'])
    },
    status: () => serviceStatus(dataDir, definitionPath, logPaths)
  }
}

function createTaskSchedulerManager(command: ServiceCommand, dataDir: string): UserServiceManager {
  const definitionPath = join(dataDir, 'service', 'loci-service.cmd')
  const taskName = 'Loci Background Service'
  const logPaths = [join(dataDir, 'logs', 'service.log')]
  return {
    definitionPath,
    logPaths,
    install: async () => {
      mkdirSync(dirname(definitionPath), { recursive: true })
      writeFileAtomically(definitionPath, renderWindowsServiceScript(command))
      await runOrThrow('schtasks.exe', [
        '/Create',
        '/TN',
        taskName,
        '/SC',
        'ONLOGON',
        '/TR',
        definitionPath,
        '/F'
      ])
      await runOrThrow('schtasks.exe', ['/Run', '/TN', taskName])
    },
    start: async () => runOrThrow('schtasks.exe', ['/Run', '/TN', taskName]),
    stop: async () => runOrThrow('schtasks.exe', ['/End', '/TN', taskName]),
    restart: async () => {
      await run('schtasks.exe', ['/End', '/TN', taskName], true)
      await runOrThrow('schtasks.exe', ['/Run', '/TN', taskName])
    },
    disable: async () => {
      await run('schtasks.exe', ['/End', '/TN', taskName], true)
      await run('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], true)
      rmSync(definitionPath, { force: true })
    },
    status: () => serviceStatus(dataDir, definitionPath, logPaths)
  }
}

async function serviceStatus(
  dataDir: string,
  definitionPath: string,
  logPaths: string[]
): Promise<ServiceStatus> {
  const state = readLocalServiceState(dataDir)
  return {
    installed: existsSync(definitionPath),
    running: Boolean(state && (await checkLocalService(state))),
    state,
    definitionPath,
    logPaths
  }
}

interface CommandResult {
  code: number
  output: string
}

async function run(command: string, args: string[], allowFailure = false): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      const result = { code: code ?? 1, output: Buffer.concat(chunks).toString('utf8').trim() }
      if (!allowFailure && result.code !== 0) {
        reject(new Error(result.output || `${command} 执行失败`))
      } else resolvePromise(result)
    })
  })
}

async function runOrThrow(command: string, args: string[]): Promise<void> {
  await run(command, args)
}

export function resolveWebAssetsDir(): string | undefined {
  const current = dirname(fileURLToPath(import.meta.url))
  const packaged = [
    join(current, 'resources', 'ui'),
    join(current, 'resources', 'ui', 'dist')
  ].find((candidate) => existsSync(join(candidate, 'index.html')))
  if (packaged) return packaged
  const workspace = join(current, '..', '..', 'web', 'dist')
  return existsSync(join(workspace, 'index.html')) ? workspace : undefined
}
