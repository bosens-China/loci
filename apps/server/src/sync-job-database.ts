import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawlFailure, CrawlProgress } from '@loci/core'
import { withImmediateTransaction as transaction } from './sqlite.js'
import type { SyncJob, SyncJobStatus } from './types.js'

const activeStatuses = "('queued', 'running', 'canceling')"

interface SyncJobRow {
  id: string
  library_id: string
  hostname: string
  status: SyncJobStatus
  owner_id: string
  lease_expires_at: string
  progress_json: string | null
  failures_json: string
  error_message: string | null
  priority: number
  paused: number
  pause_requested: number
  stop_requested: number
  partial: number
  content_bytes: number
  remaining_urls_json: string | null
  created_at: string
  updated_at: string
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
      .prepare(`${jobQuery} ORDER BY job.created_at DESC LIMIT 100`)
      .all() as unknown as SyncJobRow[]
  ).map(toSyncJob)
}

export function getSyncJob(database: DatabaseSync, id: string): PersistedSyncJob | undefined {
  const row = database.prepare(`${jobQuery} WHERE job.id = ?`).get(id) as unknown as
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
       WHERE id = ? AND owner_id = ? AND status = 'queued' AND paused = 0
         AND NOT EXISTS (
           SELECT 1 FROM sync_jobs AS active_job
           JOIN libraries AS active_library ON active_library.id = active_job.library_id
           JOIN libraries AS target_library ON target_library.id = sync_jobs.library_id
           WHERE active_job.id <> sync_jobs.id AND active_job.status = 'running'
             AND active_library.hostname = target_library.hostname
         )`
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
         error_message = ?,
         partial = CASE WHEN ? IN ('completed', 'completed_with_errors') THEN 0 ELSE partial END,
         remaining_urls_json = CASE WHEN ? IN ('completed', 'completed_with_errors') THEN NULL
           ELSE remaining_urls_json END,
         pause_requested = 0, stop_requested = 0, updated_at = ?, finished_at = ?
       WHERE id = ? AND owner_id = ?`
    )
    .run(
      status,
      progress ? JSON.stringify(progress) : null,
      JSON.stringify(failures),
      error,
      status,
      status,
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
      `UPDATE sync_jobs SET status = 'failed',
         error_message = CASE WHEN status = 'queued'
           THEN '任务尚未开始，调度进程已退出，等待人工恢复'
           ELSE '任务执行进程已退出或租约过期，等待人工恢复' END,
         updated_at = ?, finished_at = ?
       WHERE status IN ${activeStatuses} AND lease_expires_at < ?
         AND NOT (status = 'queued' AND paused = 1)`
    )
    .run(now, now, now)
}

function findActive(database: DatabaseSync, libraryId: string): SyncJobRow | undefined {
  return database
    .prepare(`${jobQuery} WHERE job.library_id = ? AND job.status IN ${activeStatuses} LIMIT 1`)
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
    hostname: row.hostname,
    status: row.status,
    priority: row.priority,
    paused: Boolean(row.paused),
    pauseRequested: Boolean(row.pause_requested),
    stopRequested: Boolean(row.stop_requested),
    partial: Boolean(row.partial),
    contentBytes: row.content_bytes,
    remainingCount: parseJson<string[]>(row.remaining_urls_json, []).length,
    ownerId: row.owner_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

const jobQuery = `SELECT job.id, job.library_id, job.status, job.owner_id,
  job.lease_expires_at, job.progress_json, job.failures_json, job.error_message,
  job.priority, job.paused, job.pause_requested, job.stop_requested, job.partial,
  job.content_bytes, job.remaining_urls_json, job.created_at, job.updated_at,
  job.finished_at, library.hostname
  FROM sync_jobs AS job JOIN libraries AS library ON library.id = job.library_id`
