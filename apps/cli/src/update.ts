import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { resolveLociCacheDir } from '@loci/runtime'

const UPDATE_CACHE_FILE = 'cli-update.json'
const NPM_LATEST_URL = 'https://registry.npmjs.org/@boses%2fcli/latest'
export const UPDATE_CHECK_ARGUMENT = '--internal-check-update'
export const UPDATE_TIMEOUT_MS = 5_000

interface UpdateCache {
  checkedOn?: string
  latestVersion?: string
}

interface NpmPackageMetadata {
  version?: unknown
}

export interface CliUpdate {
  currentVersion: string
  latestVersion: string
}

export const CLI_VERSION = readCliVersion()

/** 每天仅派生一次独立检查进程，避免网络请求阻塞用户命令。 */
export function startDailyUpdateCheck(args: readonly string[]): void {
  if (!process.stdout.isTTY || isMcpStdio(args) || args[0] === 'update') return
  if (!claimDailyUpdateCheck()) return

  const entry = process.argv[1]
  if (!entry) return
  const child = spawn(process.execPath, [entry, UPDATE_CHECK_ARGUMENT], {
    detached: true,
    stdio: 'ignore'
  })
  child.once('error', () => undefined)
  child.unref()
}

/** 后台检查入口：失败时静默，不能影响原始 CLI 命令。 */
export async function runBackgroundUpdateCheck(): Promise<void> {
  try {
    await checkForUpdate()
  } catch {
    // 网络不可用时保留当天已检查标记，下一天再重试。
  }
}

export async function checkForUpdate(fetcher: typeof fetch = fetch): Promise<CliUpdate | null> {
  const latestVersion = await fetchLatestVersion(fetcher)
  const cache = { ...readCache(), checkedOn: today(), latestVersion }
  writeCache(cache)
  return isNewerVersion(latestVersion, CLI_VERSION)
    ? { currentVersion: CLI_VERSION, latestVersion }
    : null
}

export async function fetchLatestVersion(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(NPM_LATEST_URL, { signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`检查更新失败：npm 返回 ${response.status}`)

  const payload = (await response.json()) as NpmPackageMetadata
  if (typeof payload.version !== 'string') throw new Error('检查更新失败：npm 返回了无效版本')
  return payload.version
}

export function readCachedUpdate(): CliUpdate | null {
  const latestVersion = readCache().latestVersion
  return latestVersion && isNewerVersion(latestVersion, CLI_VERSION)
    ? { currentVersion: CLI_VERSION, latestVersion }
    : null
}

export function formatUpdateMessage(update: CliUpdate): string {
  return `发现 Loci CLI v${update.latestVersion}，当前为 v${update.currentVersion}；运行 npm install --global @boses/cli@latest 更新。`
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest)
  const currentParts = parseVersion(current)
  if (!latestParts || !currentParts) return false
  for (let index = 0; index < latestParts.length; index += 1) {
    if (latestParts[index] !== currentParts[index]) {
      return latestParts[index]! > currentParts[index]!
    }
  }
  return false
}

function claimDailyUpdateCheck(): boolean {
  const cache = readCache()
  if (cache.checkedOn === today()) return false
  writeCache({ ...cache, checkedOn: today() })
  return true
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

function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function isMcpStdio(args: readonly string[]): boolean {
  return args[0] === 'mcp' && args[1] === 'stdio'
}

function cachePath(): string {
  return join(resolveLociCacheDir(), UPDATE_CACHE_FILE)
}

function readCache(): UpdateCache {
  try {
    const value = JSON.parse(readFileSync(cachePath(), 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UpdateCache) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: UpdateCache): void {
  const path = cachePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(cache)}\n`)
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
