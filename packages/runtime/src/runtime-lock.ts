import { randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface LockRecord {
  pid: number
  owner: string
  startedAt: string
}

interface StoredLockRecord extends LockRecord {
  token?: string
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

  const token = randomUUID()
  const temporaryPath = join(lockDir, `.${token}.tmp`)
  const record: StoredLockRecord = {
    pid: process.pid,
    owner,
    startedAt: new Date().toISOString(),
    token
  }
  try {
    // 完整写入后再以硬链接原子发布，读取方永远不会看到初始化中的空锁。
    writeFileSync(temporaryPath, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    withLockMutation(path, () => {
      const current = readRuntimeLock(dataDir, key)
      if (current) throw new RuntimeLockedError(`操作正在由${current.owner}执行`, current)
      if (existsSync(path)) unlinkSync(path)
      try {
        linkSync(temporaryPath, path)
      } catch (error) {
        if (!isExistingFileError(error)) throw error
        throw new RuntimeLockedError('操作已被其他 Loci 进程占用', readLock(path))
      }
    })
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
  let released = false
  return {
    path,
    release: () => {
      if (released) return
      withLockMutation(path, () => {
        if (readLock(path)?.token === token) unlinkSync(path)
      })
      released = true
    }
  }
}

/** 独立于主库的短事务串行化锁的替换与释放，防止多个回收者误删新锁。
 * 这里只使用 BEGIN IMMEDIATE 的跨进程互斥语义，不存放业务数据或参与主库迁移。
 */
function withLockMutation<T>(path: string, action: () => T): T {
  const database = new DatabaseSync(join(dirname(path), '.mutex.sqlite'), { timeout: 5000 })
  try {
    database.exec('BEGIN IMMEDIATE')
    try {
      return action()
    } finally {
      database.exec('ROLLBACK')
    }
  } finally {
    database.close()
  }
}

/** 获取抓取锁，并与全库维护锁进行双向检查，避免启动瞬间的竞态。 */
export function acquireCrawlRuntimeLock(
  dataDir: string,
  sourceId: string,
  owner: string
): RuntimeLock {
  const maintenance = readRuntimeLock(dataDir, 'maintenance')
  if (maintenance) throw new RuntimeLockedError(`数据库正在由${maintenance.owner}维护`, maintenance)
  const browserUninstall = readRuntimeLock(dataDir, 'browser-uninstall')
  if (browserUninstall) {
    throw new RuntimeLockedError(`操作正在由${browserUninstall.owner}执行`, browserUninstall)
  }
  const lock = acquireRuntimeLock(dataDir, `crawl-${sourceId}`, owner)
  try {
    const currentMaintenance = readRuntimeLock(dataDir, 'maintenance')
    if (currentMaintenance) {
      throw new RuntimeLockedError(
        `数据库正在由${currentMaintenance.owner}维护`,
        currentMaintenance
      )
    }
    const currentBrowserUninstall = readRuntimeLock(dataDir, 'browser-uninstall')
    if (currentBrowserUninstall) {
      throw new RuntimeLockedError(
        `操作正在由${currentBrowserUninstall.owner}执行`,
        currentBrowserUninstall
      )
    }
    return lock
  } catch (error) {
    lock.release()
    throw error
  }
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
  try {
    const currentMaintenance = readRuntimeLock(dataDir, 'maintenance')
    if (!currentMaintenance) return lock
    throw new RuntimeLockedError(`数据库正在由${currentMaintenance.owner}维护`, currentMaintenance)
  } catch (error) {
    lock.release()
    throw error
  }
}

/** 获取全库维护锁；抓取锁若在竞争窗口中出现，维护操作会主动让出。 */
export function acquireMaintenanceRuntimeLock(dataDir: string, owner: string): RuntimeLock {
  const lock = acquireRuntimeLock(dataDir, 'maintenance', owner)
  try {
    if (!hasActiveDatabaseWriteLocks(dataDir)) return lock
    throw new RuntimeLockedError('仍有文档源或云端副本正在同步，请等待完成后重试', null)
  } catch (error) {
    lock.release()
    throw error
  }
}

export function readRuntimeLock(dataDir: string, key: string): LockRecord | null {
  const path = join(dataDir, 'locks', `${safeKey(key)}.lock`)
  const record = readLock(path)
  if (!record && existsSync(path)) {
    // 兼容旧进程正在初始化的锁；无法证明持有者已退出时不能擅自删除。
    throw new RuntimeLockedError('锁信息尚未就绪或已损坏，请等待持有进程退出后检查锁文件', null)
  }
  // 读取只判断存活；删除必须留在串行化的获取流程中。
  return record && isProcessAlive(record.pid) ? record : null
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
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function readLock(path: string): StoredLockRecord | null {
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredLockRecord>
    return typeof value.pid === 'number' && typeof value.owner === 'string'
      ? { pid: value.pid, owner: value.owner, startedAt: value.startedAt ?? '', token: value.token }
      : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 仍表示进程存在；只有 ESRCH 可以作为安全回收依据。
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isExistingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
