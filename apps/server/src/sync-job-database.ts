import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawlFailure, CrawlProgress } from '@loci/core'
import { withImmediateTransaction as transaction } from './sqlite.js'
import type { SyncJob, SyncJobStatus } from './types.js'

const activeStatuses = "('queued', 'running', 'canceling')"

interface SyncJobRow {
  id: string
  library_id: string
  status: SyncJobStatus
  owner_id: string
  lease_expires_at: string
  progress_json: string | null
  failures_json: string
  error_message: string | null
  created_at: string
  finished_at: string | null
}

export interface PersistedSyncJob extends SyncJob {
  ownerId: string
  leaseExpiresAt: string
}

export function getOrCreateSyncJob(
  database: DatabaseSync,
  libraryId: string,
  ownerId: string,
  leaseExpiresAt: string
): { job: PersistedSyncJob; created: boolean } {
  return transaction(database, () => {
    expireLeases(database)
    const existing = findActive(database, libraryId)
    if (existing) return { job: toSyncJob(existing), created: false }
    const id = randomUUID()
    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO sync_jobs
         (id, library_id, status, owner_id, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?)`
      )
      .run(id, libraryId, ownerId, leaseExpiresAt, now, now)
    return { job: requireSyncJob(database, id), created: true }
  })
}

export function listSyncJobs(database: DatabaseSync): PersistedSyncJob[] {
  return (
    database
      .prepare(`${jobQuery} ORDER BY created_at DESC LIMIT 100`)
      .all() as unknown as SyncJobRow[]
  ).map(toSyncJob)
}

export function getSyncJob(database: DatabaseSync, id: string): PersistedSyncJob | undefined {
  const row = database.prepare(`${jobQuery} WHERE id = ?`).get(id) as unknown as
    SyncJobRow | undefined
  return row ? toSyncJob(row) : undefined
}

export function isLibrarySyncActive(database: DatabaseSync, libraryId: string): boolean {
  expireLeases(database)
  return Boolean(findActive(database, libraryId))
}

export function markSyncJobRunning(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  leaseExpiresAt: string
): boolean {
  const result = database
    .prepare(
      `UPDATE sync_jobs SET status = 'running', lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'queued'`
    )
    .run(leaseExpiresAt, new Date().toISOString(), id, ownerId)
  return Number(result.changes) === 1
}

export function heartbeatSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  leaseExpiresAt: string,
  progress?: CrawlProgress | null
): boolean {
  const result = database
    .prepare(
      `UPDATE sync_jobs SET lease_expires_at = ?,
         progress_json = COALESCE(?, progress_json), updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('queued', 'running')`
    )
    .run(
      leaseExpiresAt,
      progress === undefined ? null : JSON.stringify(progress),
      new Date().toISOString(),
      id,
      ownerId
    )
  return Number(result.changes) === 1
}

export function finishSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  status: Exclude<SyncJobStatus, 'queued' | 'running' | 'canceling'>,
  progress: CrawlProgress | null,
  failures: CrawlFailure[],
  error: string | null
): PersistedSyncJob {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET status = ?, progress_json = ?, failures_json = ?,
         error_message = ?, updated_at = ?, finished_at = ?
       WHERE id = ? AND owner_id = ?`
    )
    .run(
      status,
      progress ? JSON.stringify(progress) : null,
      JSON.stringify(failures),
      error,
      now,
      now,
      id,
      ownerId
    )
  return requireSyncJob(database, id)
}

export function requestSyncJobCancel(
  database: DatabaseSync,
  id: string
): PersistedSyncJob | undefined {
  return transaction(database, () => {
    const current = getSyncJob(database, id)
    if (!current || !isActive(current.status)) return current
    const status = current.status === 'queued' ? 'canceled' : 'canceling'
    const now = new Date().toISOString()
    database
      .prepare(
        `UPDATE sync_jobs SET status = ?, updated_at = ?,
           finished_at = CASE WHEN ? = 'canceled' THEN ? ELSE finished_at END
         WHERE id = ?`
      )
      .run(status, now, status, now, id)
    return requireSyncJob(database, id)
  })
}

export function expireSyncJobLeases(database: DatabaseSync): void {
  expireLeases(database)
}

export function assertSyncJobOwned(database: DatabaseSync, id: string, ownerId: string): void {
  const row = database
    .prepare(
      `SELECT 1 FROM sync_jobs
       WHERE id = ? AND owner_id = ? AND status = 'running' AND lease_expires_at >= ?`
    )
    .get(id, ownerId, new Date().toISOString())
  if (!row) throw new Error('同步任务租约已失效')
}

function expireLeases(database: DatabaseSync): void {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET status = 'failed', error_message = '任务执行进程已退出或租约过期',
         updated_at = ?, finished_at = ?
       WHERE status IN ${activeStatuses} AND lease_expires_at < ?`
    )
    .run(now, now, now)
}

function findActive(database: DatabaseSync, libraryId: string): SyncJobRow | undefined {
  return database
    .prepare(`${jobQuery} WHERE library_id = ? AND status IN ${activeStatuses} LIMIT 1`)
    .get(libraryId) as unknown as SyncJobRow | undefined
}

function requireSyncJob(database: DatabaseSync, id: string): PersistedSyncJob {
  const job = getSyncJob(database, id)
  if (!job) throw new Error('同步任务不存在')
  return job
}

function toSyncJob(row: SyncJobRow): PersistedSyncJob {
  return {
    id: row.id,
    libraryId: row.library_id,
    status: row.status,
    ownerId: row.owner_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    progress: parseJson<CrawlProgress | null>(row.progress_json, null),
    failures: parseJson<CrawlFailure[]>(row.failures_json, []),
    error: row.error_message
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function isActive(status: SyncJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'canceling'
}

const jobQuery = `SELECT id, library_id, status, owner_id, lease_expires_at,
  progress_json, failures_json, error_message, created_at, finished_at FROM sync_jobs`
