import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  UPDATE_TIMEOUT_MS,
  checkForCliUpdate,
  isUpdateCheckDue,
  fetchLatestCliVersion,
  formatCliUpdateMessage,
  isUpdateCheckDisabled,
  readCachedUpdateStatus,
  triggerBackgroundUpdateCheck,
  type UpdateCheckStatus
} from '@loci/runtime'

export { isNewerVersion } from '@loci/shared'
export { UPDATE_TIMEOUT_MS }

export const UPDATE_CHECK_ARGUMENT = '--internal-check-update'

const SKIPPED_FIRST_ARGS = new Set([
  'upgrade',
  '__crawl',
  UPDATE_CHECK_ARGUMENT,
  '--version',
  '-V',
  '-v'
])

export interface CliUpdate {
  currentVersion: string
  latestVersion: string
}

export interface UpdateNotifyOptions {
  isTTY?: boolean
  env?: NodeJS.ProcessEnv
}

export const CLI_VERSION = readCliVersion()

/** 判断当前 CLI 调用是否应触发后台更新检查并展示更新提示（支持无参数裸敲 loci）。 */
export function shouldNotifyUpdate(
  args: readonly string[],
  options: UpdateNotifyOptions = {}
): boolean {
  const isTTY = options.isTTY ?? Boolean(process.stderr.isTTY)
  if (!isTTY) return false
  if (isUpdateCheckDisabled(options.env)) return false
  if (args.includes('--json')) return false
  const first = args[0]
  if (first && SKIPPED_FIRST_ARGS.has(first)) return false
  return true
}

/** 按时间窗口派生独立后台检查进程，绝不阻塞当前命令或向外抛出异常。 */
export function startDailyUpdateCheck(
  args: readonly string[],
  options: UpdateNotifyOptions & { cacheDir?: string; now?: number } = {}
): void {
  if (!shouldNotifyUpdate(args, options)) return
  if (!isUpdateCheckDue(options)) return

  const entry = process.argv[1]
  if (!entry) return
  try {
    const loader = entry.endsWith('.ts')
      ? ['--import', createRequire(import.meta.url).resolve('tsx')]
      : []
    const child = spawn(process.execPath, [...loader, entry, UPDATE_CHECK_ARGUMENT], {
      detached: true,
      env: options.cacheDir ? { ...process.env, LOCI_CACHE_DIR: options.cacheDir } : undefined,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // 后台更新检查失败静默降级，避免影响主命令执行。
  }
}

/** 后台检查入口：失败时静默，不能影响原始 CLI 命令。 */
export async function runBackgroundUpdateCheck(): Promise<void> {
  await triggerBackgroundUpdateCheck(CLI_VERSION)
}

export async function checkForUpdate(
  fetcher: typeof fetch = fetch,
  options: { cacheDir?: string; now?: number } = {}
): Promise<CliUpdate | null> {
  const status = await checkForCliUpdate(CLI_VERSION, {
    fetcher,
    cacheDir: options.cacheDir,
    now: options.now
  })
  return toCliUpdate(status)
}

export async function fetchLatestVersion(fetcher: typeof fetch = fetch): Promise<string> {
  return fetchLatestCliVersion(fetcher)
}

export function readCachedUpdate(options: { cacheDir?: string } = {}): CliUpdate | null {
  return toCliUpdate(readCachedUpdateStatus(CLI_VERSION, options))
}

export function formatUpdateMessage(update: CliUpdate): string {
  return formatCliUpdateMessage({
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    updateAvailable: true,
    checkedAt: null,
    checking: false,
    checkFailed: false,
    upgradeCommand: 'npm install --global @boses/cli@latest'
  })
}

/** 在命令执行完毕后向 stderr 输出缓存中的更新提示，避免被长输出冲走。 */
export function printCachedUpdateNotice(options: { cacheDir?: string } = {}): void {
  const update = readCachedUpdate(options)
  if (update) process.stderr.write(`\n${formatUpdateMessage(update)}\n`)
}

function toCliUpdate(status: UpdateCheckStatus): CliUpdate | null {
  return status.updateAvailable
    ? { currentVersion: status.currentVersion, latestVersion: status.latestVersion }
    : null
}

function readCliVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as unknown
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('无法读取 CLI 版本')
  }
  const version = (packageJson as { version?: unknown }).version
  if (typeof version !== 'string') throw new Error('无法读取 CLI 版本')
  return version
}
