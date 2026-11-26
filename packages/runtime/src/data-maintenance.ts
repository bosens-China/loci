import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ClearDataScope } from '@loci/shared'
import type { LociDatabase } from './database.js'
import type { BackupImportOptions } from './database-backup.js'
import {
  acquireMaintenanceRuntimeLock,
  readRuntimeLock,
  RuntimeLockedError
} from './runtime-lock.js'

/** 相同的在途维护操作共享持锁者的事务回执，后续主动执行可以再次维护。 */
async function withDataMaintenanceLock<T>(
  dataDir: string,
  owner: string,
  hash: string,
  signal: AbortSignal,
  run: (operationId: string) => T | Promise<T>,
  receipt: (operationId: string) => T | undefined
): Promise<T> {
  signal.throwIfAborted()
  const operation = { hash, id: randomUUID() }
  let lock
  try {
    lock = acquireMaintenanceRuntimeLock(dataDir, owner, operation)
  } catch (error) {
    const active =
      error instanceof RuntimeLockedError ? error.record?.maintenanceOperation : undefined
    if (active?.hash !== hash) throw error
    while (readRuntimeLock(dataDir, 'maintenance')?.maintenanceOperation?.id === active.id) {
      await delay(50, undefined, { signal })
    }
    signal.throwIfAborted()
    const summary = receipt(active.id)
    if (summary === undefined) throw new Error('并行维护未提交，请重试')
    return summary
  }
  try {
    return await run(operation.id)
  } finally {
    lock.release()
  }
}

export function importWithMaintenanceLock(
  database: LociDatabase,
  dataDir: string,
  owner: string,
  bytes: Buffer,
  options: BackupImportOptions | undefined,
  signal: AbortSignal
) {
  const hash = `${options?.replaceAll === true}:${createHash('sha256').update(bytes).digest('hex')}`
  return withDataMaintenanceLock(
    dataDir,
    `${owner} 数据导入`,
    hash,
    signal,
    (id) => database.importBackupArchive(bytes, options, id),
    database.getBackupImportSummary
  )
}

export function clearWithMaintenanceLock(
  database: LociDatabase,
  dataDir: string,
  owner: string,
  scope: ClearDataScope,
  signal: AbortSignal
) {
  return withDataMaintenanceLock(
    dataDir,
    `${owner} 清空数据`,
    `clear:${scope}`,
    signal,
    (id) => database.clearData(scope, id),
    database.getClearDataSummary
  )
}
