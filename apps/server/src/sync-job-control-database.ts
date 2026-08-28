import type { DatabaseSync } from 'node:sqlite'
import type { CrawlProgress } from '@loci/core'
import { getSyncJob, requireSyncJob, type PersistedSyncJob } from './sync-job-database.js'

export function requestSyncJobPause(
  database: DatabaseSync,
  id: string
): PersistedSyncJob | undefined {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET pause_requested = 1,
         paused = CASE WHEN status = 'queued' THEN 1 ELSE paused END, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(now, id)
  return getSyncJob(database, id)
}

export function resumeSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  leaseExpiresAt: string
): PersistedSyncJob | undefined {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET status = 'queued', paused = 0, pause_requested = 0,
         stop_requested = 0, error_message = NULL, finished_at = NULL,
         owner_id = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND (
         status = 'queued' OR status = 'failed' OR (status = 'completed' AND partial = 1)
       )`
    )
    .run(ownerId, leaseExpiresAt, now, id)
  return getSyncJob(database, id)
}

export function requestSyncJobStop(
  database: DatabaseSync,
  id: string
): PersistedSyncJob | undefined {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET stop_requested = 1,
         status = CASE WHEN status = 'queued' THEN 'completed' ELSE status END,
         partial = CASE WHEN status = 'queued' THEN 1 ELSE partial END,
         finished_at = CASE WHEN status = 'queued' THEN ? ELSE finished_at END,
         updated_at = ? WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(now, now, id)
  return getSyncJob(database, id)
}

export function setSyncJobPriority(
  database: DatabaseSync,
  id: string,
  priority: number
): PersistedSyncJob | undefined {
  database
    .prepare(
      `UPDATE sync_jobs SET priority = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(Math.max(-100, Math.min(100, Math.trunc(priority))), new Date().toISOString(), id)
  return getSyncJob(database, id)
}

export function checkpointSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  progress: CrawlProgress,
  pendingUrls: readonly string[],
  contentBytes: number
): boolean {
  return (
    database
      .prepare(
        `UPDATE sync_jobs SET progress_json = ?, remaining_urls_json = ?, content_bytes = ?,
           updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'`
      )
      .run(
        JSON.stringify(progress),
        JSON.stringify(pendingUrls),
        Math.max(0, Math.trunc(contentBytes)),
        new Date().toISOString(),
        id,
        ownerId
      ).changes === 1
  )
}

export function releasePausedSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string
): PersistedSyncJob {
  database
    .prepare(
      `UPDATE sync_jobs SET status = 'queued', paused = 1, pause_requested = 0,
         updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'`
    )
    .run(new Date().toISOString(), id, ownerId)
  return requireSyncJob(database, id)
}

export function finishPartialSyncJob(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  progress: CrawlProgress | null,
  contentBytes: number
): PersistedSyncJob {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE sync_jobs SET status = 'completed', partial = 1, stop_requested = 0,
         progress_json = ?, content_bytes = ?, updated_at = ?, finished_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'running'`
    )
    .run(
      progress ? JSON.stringify(progress) : null,
      Math.max(0, Math.trunc(contentBytes)),
      now,
      now,
      id,
      ownerId
    )
  return requireSyncJob(database, id)
}

export function readSyncJobResumeUrls(database: DatabaseSync, id: string): string[] {
  const row = database
    .prepare('SELECT remaining_urls_json FROM sync_jobs WHERE id = ?')
    .get(id) as unknown as { remaining_urls_json: string | null } | undefined
  if (!row?.remaining_urls_json) return []
  try {
    const parsed = JSON.parse(row.remaining_urls_json) as unknown
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}
