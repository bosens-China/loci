import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isNewerVersion, type UpdateCheckStatus } from '@loci/shared'
import { writeFileAtomically } from './atomic-file.js'
import { resolveLociCacheDir } from './data-path.js'
import { acquireRuntimeLock, readRuntimeLock, RuntimeLockedError } from './runtime-lock.js'

export type { UpdateCheckStatus } from '@loci/shared'

export const UPDATE_CACHE_FILE = 'cli-update.json'
export const NPM_LATEST_URL = 'https://registry.npmjs.org/@boses%2fcli/latest'
export const UPDATE_TIMEOUT_MS = 5_000
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const UPDATE_RETRY_INTERVAL_MS = 60 * 60 * 1000
export const DEFAULT_UPGRADE_COMMAND = 'npm install --global @boses/cli@latest'

export interface UpdateCheckCache {
  checkedAt?: number
  attemptedAt?: number
  attemptId?: string
  failed?: boolean
  latestVersion?: string
  /** 兼容旧版按自然日记录的缓存字段。 */
  checkedOn?: string
}

export interface UpdateCheckOptions {
  cacheDir?: string
  fetcher?: typeof fetch
  now?: number
}

interface NpmPackageMetadata {
  version?: unknown
}

const lockKey = 'cli-update-check'
// 同进程共享 Promise，跨进程通过同一缓存目录的锁和检查回执合并。
const inFlightChecks = new Map<string, Promise<UpdateCheckCache>>()

/** 读取禁用自动更新检查的环境变量（显式关闭或 CI 环境）。 */
export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isTruthyFlag(env.LOCI_NO_UPDATE_CHECK) ||
    isTruthyFlag(env.NO_UPDATE_NOTIFIER) ||
    isTruthyFlag(env.CI)
  )
}

/** 读取当前运行时包版本，作为未显式传入版本时的兜底。 */
export function readRuntimeVersion(): string {
  try {
    const raw = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const version = (raw as { version?: unknown }).version
      if (typeof version === 'string' && version.trim()) return version
    }
  } catch {
    // 兜底失败时返回默认占位版本，避免阻断服务启动。
  }
  return '0.0.0'
}

export function resolveUpdateCachePath(cacheDir?: string): string {
  return join(resolve(cacheDir ?? resolveLociCacheDir()), UPDATE_CACHE_FILE)
}

export function readUpdateCache(cacheDir?: string): UpdateCheckCache {
  try {
    const raw = JSON.parse(readFileSync(resolveUpdateCachePath(cacheDir), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const record = raw as Record<string, unknown>
    return {
      checkedAt:
        typeof record.checkedAt === 'number' && Number.isFinite(record.checkedAt)
          ? record.checkedAt
          : undefined,
      attemptedAt:
        typeof record.attemptedAt === 'number' && Number.isFinite(record.attemptedAt)
          ? record.attemptedAt
          : undefined,
      latestVersion: typeof record.latestVersion === 'string' ? record.latestVersion : undefined,
      attemptId: typeof record.attemptId === 'string' ? record.attemptId : undefined,
      failed: record.failed === true || undefined,
      checkedOn: typeof record.checkedOn === 'string' ? record.checkedOn : undefined
    }
  } catch {
    return {}
  }
}

/** 原子写入缓存，任何文件系统异常静默降级，避免影响主流程。 */
export function writeUpdateCache(cache: UpdateCheckCache, cacheDir?: string): boolean {
  try {
    writeFileAtomically(resolveUpdateCachePath(cacheDir), `${JSON.stringify(cache)}\n`)
    return true
  } catch {
    return false
  }
}

/** 判断当前缓存是否已到期：成功检查 24h 节流，失败尝试 1h 节流。 */
export function shouldCheckForUpdate(cache: UpdateCheckCache, now = Date.now()): boolean {
  if (typeof cache.checkedAt === 'number' && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    return false
  }
  if (typeof cache.attemptedAt === 'number' && now - cache.attemptedAt < UPDATE_RETRY_INTERVAL_MS) {
    return false
  }
  if (
    cache.checkedAt === undefined &&
    cache.attemptedAt === undefined &&
    cache.checkedOn === formatLocalDate(now)
  ) {
    return false
  }
  return true
}

/** 派生后台进程前做一次只读判断。是否真正请求由持锁进程重新确认。 */
export function isUpdateCheckDue(options: { cacheDir?: string; now?: number } = {}): boolean {
  return shouldCheckForUpdate(readUpdateCache(options.cacheDir), options.now)
}

export function isUpdateCheckRunning(cacheDir?: string): boolean {
  const directory = resolve(cacheDir ?? resolveLociCacheDir())
  if (inFlightChecks.has(directory)) return true
  try {
    return Boolean(readRuntimeLock(directory, lockKey))
  } catch {
    return false
  }
}

/** 同步读取缓存并生成统一更新状态，不发起任何网络请求。 */
export function readCachedUpdateStatus(
  currentVersion: string,
  options: { cacheDir?: string } = {}
): UpdateCheckStatus {
  const checking = isUpdateCheckRunning(options.cacheDir)
  return toUpdateCheckStatus(currentVersion, readUpdateCache(options.cacheDir), checking)
}

export async function fetchLatestCliVersion(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(NPM_LATEST_URL, { signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`检查更新失败：npm 返回 ${response.status}`)

  const payload = (await response.json()) as NpmPackageMetadata
  if (typeof payload.version !== 'string' || !payload.version.trim()) {
    throw new Error('检查更新失败：npm 返回了无效版本')
  }
  return payload.version
}

export function checkForCliUpdate(
  currentVersion: string,
  options: UpdateCheckOptions = {}
): Promise<UpdateCheckStatus> {
  return checkUpdate(currentVersion, options, false)
}

async function checkUpdate(
  currentVersion: string,
  options: UpdateCheckOptions,
  background: boolean
): Promise<UpdateCheckStatus> {
  const directory = resolve(options.cacheDir ?? resolveLociCacheDir())
  let job = inFlightChecks.get(directory)
  if (!job) {
    job = runUpdateCheck(directory, options, background)
    inFlightChecks.set(directory, job)
    const settled = () => inFlightChecks.delete(directory)
    void job.then(settled, settled)
  }
  return toUpdateCheckStatus(currentVersion, await job, false)
}

async function runUpdateCheck(
  directory: string,
  options: UpdateCheckOptions,
  background: boolean
): Promise<UpdateCheckCache> {
  const signal = AbortSignal.timeout(UPDATE_TIMEOUT_MS + 2500)
  while (true) {
    signal.throwIfAborted()
    const observed = readUpdateCache(directory)
    if (background && !shouldCheckForUpdate(observed, options.now)) return observed
    const attemptId = randomUUID()
    let lock
    try {
      lock = acquireRuntimeLock(directory, lockKey, 'CLI 更新检查', attemptId)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError) || !error.record?.crawlRunId) throw error
      const activeId = error.record.crawlRunId
      while (readRuntimeLock(directory, lockKey)?.crawlRunId === activeId)
        await delay(100, undefined, { signal })
      const result = readUpdateCache(directory)
      if (
        result.attemptId === activeId ||
        (result.attemptId && result.attemptId !== observed.attemptId)
      ) {
        if (result.failed) throw new Error('在线检查更新失败，请重试')
        return result
      }
      // 持锁进程中断而未写入回执时，调用方可接续检查。
      continue
    }

    try {
      const previous = readUpdateCache(directory)
      if (previous.attemptId && previous.attemptId !== observed.attemptId) {
        if (previous.failed) throw new Error('在线检查更新失败，请重试')
        return previous
      }
      const now = options.now ?? Date.now()
      if (background && !shouldCheckForUpdate(previous, now)) return previous
      let latestVersion: string
      try {
        latestVersion = await fetchLatestCliVersion(options.fetcher)
      } catch (error) {
        writeUpdateCache({ ...previous, attemptedAt: now, attemptId, failed: true }, directory)
        throw error
      }
      const result = { checkedAt: now, attemptedAt: now, attemptId, latestVersion }
      writeUpdateCache(result, directory)
      return result
    } finally {
      lock.release()
    }
  }
}

/** 常驻进程（如本地 Web 服务）的非阻塞后台检查入口：受节流与禁用开关控制，失败静默。 */
export function triggerBackgroundUpdateCheck(
  currentVersion: string,
  options: UpdateCheckOptions & { env?: NodeJS.ProcessEnv } = {}
): Promise<UpdateCheckStatus> | null {
  if (isUpdateCheckDisabled(options.env)) return null
  if (!isUpdateCheckDue(options)) return null
  return checkUpdate(currentVersion, options, true).catch(() =>
    readCachedUpdateStatus(currentVersion, { cacheDir: options.cacheDir })
  )
}

export function formatCliUpdateMessage(status: UpdateCheckStatus): string {
  return `发现 Loci CLI v${status.latestVersion}，当前为 v${status.currentVersion}；运行 ${status.upgradeCommand} 更新。`
}

function toUpdateCheckStatus(
  currentVersion: string,
  cache: UpdateCheckCache,
  checking: boolean
): UpdateCheckStatus {
  const { latestVersion, checkedAt } = cache
  const updateAvailable = Boolean(latestVersion && isNewerVersion(latestVersion, currentVersion))
  return {
    currentVersion,
    latestVersion: updateAvailable && latestVersion ? latestVersion : currentVersion,
    updateAvailable,
    checkedAt:
      checkedAt !== undefined && Math.abs(checkedAt) <= 8.64e15
        ? new Date(checkedAt).toISOString()
        : null,
    checking,
    checkFailed: cache.failed === true,
    upgradeCommand: DEFAULT_UPGRADE_COMMAND
  }
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function formatLocalDate(timestamp: number): string {
  const now = new Date(timestamp)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
