import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export interface LockRecord {
  pid: number
  owner: string
  startedAt: string
}

export interface RuntimeLock {
  path: string
  release: () => void
}

export class RuntimeLockedError extends Error {
  constructor(
    message: string,
    readonly record: LockRecord | null
  ) {
    super(message)
    this.name = 'RuntimeLockedError'
  }
}

/** 文件锁让后台服务与 CLI 对抓取和 MCP 进行跨进程仲裁。 */
export function acquireRuntimeLock(dataDir: string, key: string, owner: string): RuntimeLock {
  const lockDir = join(dataDir, 'locks')
  mkdirSync(lockDir, { recursive: true })
  const path = join(lockDir, `${safeKey(key)}.lock`)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, 'wx', 0o600)
      const record: LockRecord = { pid: process.pid, owner, startedAt: new Date().toISOString() }
      writeFileSync(descriptor, JSON.stringify(record), 'utf8')
      closeSync(descriptor)
      let released = false
      return {
        path,
        release: () => {
          if (released) return
          released = true
          try {
            const current = readLock(path)
            if (current?.pid === process.pid) unlinkSync(path)
          } catch {
            // 锁已经被清理时无需再次处理。
          }
        }
      }
    } catch (error) {
      if (!isExistingFileError(error)) throw error
      const record = readLock(path)
      if (record && isProcessAlive(record.pid)) {
        throw new RuntimeLockedError(`操作正在由${record.owner}执行`, record)
      }
      try {
        unlinkSync(path)
      } catch {
        // 下一轮创建会给出最终结果。
      }
    }
  }
  throw new RuntimeLockedError('操作已被其他 Loci 进程占用', readLock(path))
}

/** 获取抓取锁，并与全库维护锁进行双向检查，避免启动瞬间的竞态。 */
export function acquireCrawlRuntimeLock(
  dataDir: string,
  sourceId: string,
  owner: string
): RuntimeLock {
  const maintenance = readRuntimeLock(dataDir, 'maintenance')
  if (maintenance) throw new RuntimeLockedError(`数据库正在由${maintenance.owner}维护`, maintenance)
  const lock = acquireRuntimeLock(dataDir, `crawl-${sourceId}`, owner)
  const currentMaintenance = readRuntimeLock(dataDir, 'maintenance')
  if (!currentMaintenance) return lock
  lock.release()
  throw new RuntimeLockedError(`数据库正在由${currentMaintenance.owner}维护`, currentMaintenance)
}

/** 获取会修改主数据库的资源锁，并与全库维护锁双向仲裁。 */
export function acquireDatabaseWriteRuntimeLock(
  dataDir: string,
  key: string,
  owner: string
): RuntimeLock {
  const maintenance = readRuntimeLock(dataDir, 'maintenance')
  if (maintenance) throw new RuntimeLockedError(`数据库正在由${maintenance.owner}维护`, maintenance)
  const lock = acquireRuntimeLock(dataDir, key, owner)
  const currentMaintenance = readRuntimeLock(dataDir, 'maintenance')
  if (!currentMaintenance) return lock
  lock.release()
  throw new RuntimeLockedError(`数据库正在由${currentMaintenance.owner}维护`, currentMaintenance)
}

/** 获取全库维护锁；抓取锁若在竞争窗口中出现，维护操作会主动让出。 */
export function acquireMaintenanceRuntimeLock(dataDir: string, owner: string): RuntimeLock {
  const lock = acquireRuntimeLock(dataDir, 'maintenance', owner)
  if (!hasActiveDatabaseWriteLocks(dataDir)) return lock
  lock.release()
  throw new RuntimeLockedError('仍有文档源或云端副本正在同步，请等待完成后重试', null)
}

export function readRuntimeLock(dataDir: string, key: string): LockRecord | null {
  const path = join(dataDir, 'locks', `${safeKey(key)}.lock`)
  const record = readLock(path)
  if (!record) return null
  if (isProcessAlive(record.pid)) return record
  try {
    unlinkSync(path)
  } catch {
    // 陈旧锁稍后仍可由获取锁流程清理。
  }
  return null
}

export function hasActiveCrawlLocks(dataDir: string): boolean {
  return hasActiveLocks(dataDir, (file) => file.startsWith('crawl-'))
}

export function hasActiveDatabaseWriteLocks(dataDir: string): boolean {
  return hasActiveLocks(dataDir, (file) => file.startsWith('crawl-') || file.startsWith('cloud-'))
}

function hasActiveLocks(dataDir: string, matches: (file: string) => boolean): boolean {
  try {
    return readdirSync(join(dataDir, 'locks'))
      .filter((file) => matches(file) && file.endsWith('.lock'))
      .some((file) => Boolean(readRuntimeLock(dataDir, file.slice(0, -'.lock'.length))))
  } catch {
    return false
  }
}

function readLock(path: string): LockRecord | null {
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
    return typeof value.pid === 'number' && typeof value.owner === 'string'
      ? { pid: value.pid, owner: value.owner, startedAt: value.startedAt ?? '' }
      : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isExistingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
