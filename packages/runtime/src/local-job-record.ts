import type { DatabaseSync } from 'node:sqlite'
import type {
  CrawlProgress,
  LocalJob,
  LocalJobKind,
  LocalJobStatus,
  LocalJobTrigger
} from '@loci/shared'
import { addColumn } from './sqlite.js'
import { cleanupCancelledSources } from './local-job-cancellation.js'

type GetLocalJob = (id: string) => LocalJob | undefined

export function initializeLocalJobControlColumns(database: DatabaseSync): void {
  addColumn(database, 'local_jobs', 'priority', 'INTEGER NOT NULL DEFAULT 0')
  for (const column of ['paused', 'pause_requested', 'stop_requested', 'partial']) {
    addColumn(
      database,
      'local_jobs',
      column,
      `INTEGER NOT NULL DEFAULT 0 CHECK (${column} IN (0, 1))`
    )
  }
  addColumn(database, 'local_jobs', 'content_bytes', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(database, 'local_jobs', 'resume_urls_json', 'TEXT')
  addColumn(
    database,
    'local_jobs',
    'delete_source_on_cancel',
    'INTEGER NOT NULL DEFAULT 0 CHECK (delete_source_on_cancel IN (0, 1))'
  )
}

export const LOCAL_JOB_QUERY = `
  SELECT job.id, job.kind, job.resource_key, job.source_id, source.hostname, job.trigger,
    job.status, job.scheduled_at, job.started_at, job.finished_at, job.lease_owner,
    job.lease_expires_at, job.heartbeat_at, job.attempt_count, job.cancel_requested,
    job.error_message, job.result_json, job.priority, job.paused, job.pause_requested,
    job.stop_requested, job.partial, job.content_bytes, job.resume_urls_json,
    job.delete_source_on_cancel,
    job.created_at, job.updated_at
  FROM local_jobs AS job
  JOIN document_sources AS source ON source.id = job.source_id`

export interface LocalJobRow {
  id: string
  kind: LocalJobKind
  resource_key: string
  source_id: string
  hostname: string
  trigger: LocalJobTrigger
  status: LocalJobStatus
  scheduled_at: string
  started_at: string | null
  finished_at: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  attempt_count: number
  cancel_requested: number
  error_message: string | null
  result_json: string | null
  priority: number
  paused: number
  pause_requested: number
  stop_requested: number
  partial: number
  content_bytes: number
  resume_urls_json: string | null
  delete_source_on_cancel: number
  created_at: string
  updated_at: string
}

export function pauseLocalJob(
  database: DatabaseSync,
  id: string,
  getLocalJob: GetLocalJob
): LocalJob | undefined {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET pause_requested = 1,
         paused = CASE WHEN status = 'pending' THEN 1 ELSE paused END, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'running') AND cancel_requested = 0`
    )
    .run(now, id)
  return getLocalJob(id)
}

export function resumeLocalJob(
  database: DatabaseSync,
  id: string,
  getLocalJob: GetLocalJob
): LocalJob | undefined {
  const target = getLocalJob(id)
  if (!target) return undefined
  const resumable =
    target.status === 'pending' ||
    target.status === 'failed' ||
    (target.status === 'completed' && target.partial)
  if (!resumable) return target

  const active = database
    .prepare(
      `${LOCAL_JOB_QUERY} WHERE job.kind = ? AND job.resource_key = ?
       AND job.status IN ('pending', 'running') AND job.id <> ? LIMIT 1`
    )
    .get(target.kind, target.resourceKey, id) as unknown as LocalJobRow | undefined
  if (active) return toLocalJob(active)

  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET status = 'pending', paused = 0, pause_requested = 0,
         stop_requested = 0, scheduled_at = ?, finished_at = NULL,
         lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
         attempt_count = CASE WHEN status = 'failed' THEN 0 ELSE attempt_count END,
         error_message = NULL, updated_at = ?
       WHERE id = ? AND cancel_requested = 0 AND (
         status = 'pending' OR status = 'failed' OR (status = 'completed' AND partial = 1)
       )`
    )
    .run(now, now, id)
  return getLocalJob(id)
}

export function pauseLocalJobs(database: DatabaseSync, hostname?: string): number {
  const now = new Date().toISOString()
  const scope = hostname
    ? `AND source_id IN (SELECT id FROM document_sources WHERE hostname = ?)`
    : ''
  const parameters = hostname ? [now, hostname] : [now]
  return Number(
    database
      .prepare(
        `UPDATE local_jobs SET pause_requested = 1,
           paused = CASE WHEN status = 'pending' THEN 1 ELSE paused END, updated_at = ?
         WHERE status IN ('pending', 'running') AND cancel_requested = 0 ${scope}`
      )
      .run(...parameters).changes
  )
}

export function resumeLocalJobs(database: DatabaseSync, hostname?: string): number {
  const now = new Date().toISOString()
  const scope = hostname
    ? `AND source_id IN (SELECT id FROM document_sources WHERE hostname = ?)`
    : ''
  const parameters = hostname ? [now, now, hostname] : [now, now]
  return Number(
    database
      .prepare(
        `UPDATE local_jobs SET paused = 0, pause_requested = 0, scheduled_at = ?,
           error_message = NULL, updated_at = ?
         WHERE status = 'pending' AND paused = 1 AND cancel_requested = 0 ${scope}`
      )
      .run(...parameters).changes
  )
}

export function stopLocalJob(
  database: DatabaseSync,
  id: string,
  getLocalJob: GetLocalJob
): LocalJob | undefined {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET stop_requested = 1,
         status = CASE WHEN status = 'pending' THEN 'completed' ELSE status END,
         partial = CASE WHEN status = 'pending' THEN 1 ELSE partial END,
         finished_at = CASE WHEN status = 'pending' THEN ? ELSE finished_at END,
         error_message = CASE WHEN status = 'pending' THEN NULL ELSE error_message END,
         updated_at = ?
       WHERE id = ? AND status IN ('pending', 'running') AND cancel_requested = 0`
    )
    .run(now, now, id)
  return getLocalJob(id)
}

export function setLocalJobPriority(
  database: DatabaseSync,
  id: string,
  priority: number,
  getLocalJob: GetLocalJob
): LocalJob | undefined {
  const normalized = Math.max(-100, Math.min(100, Math.trunc(priority)))
  database
    .prepare(
      `UPDATE local_jobs SET priority = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'running')`
    )
    .run(normalized, new Date().toISOString(), id)
  return getLocalJob(id)
}

/** 用户手动开始任务时，只抢占同 hostname 的其他运行任务。 */
export function promoteHostnameJob(
  database: DatabaseSync,
  id: string,
  sourceId: string,
  now: Date
): void {
  const timestamp = now.toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET priority = 100, paused = 0, pause_requested = 0,
         scheduled_at = CASE WHEN status = 'pending' THEN ? ELSE scheduled_at END, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'running')`
    )
    .run(timestamp, timestamp, id)
  database
    .prepare(
      `UPDATE local_jobs SET pause_requested = 1, updated_at = ?
       WHERE id <> ? AND status = 'running' AND cancel_requested = 0
         AND source_id IN (
           SELECT candidate.id FROM document_sources AS candidate
           JOIN document_sources AS target ON target.id = ?
           WHERE candidate.hostname = target.hostname
         )`
    )
    .run(timestamp, id, sourceId)
}

export function checkpointLocalJob(
  database: DatabaseSync,
  id: string,
  owner: string,
  progress: CrawlProgress,
  pendingUrls: readonly string[],
  contentBytes: number
): boolean {
  return (
    database
      .prepare(
        `UPDATE local_jobs SET result_json = ?, resume_urls_json = ?, content_bytes = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ? AND cancel_requested = 0`
      )
      .run(
        JSON.stringify(progress),
        JSON.stringify([...pendingUrls]),
        Math.max(0, Math.trunc(contentBytes)),
        new Date().toISOString(),
        id,
        owner
      ).changes === 1
  )
}

export function releasePausedLocalJob(database: DatabaseSync, id: string, owner: string): boolean {
  const now = new Date().toISOString()
  return (
    database
      .prepare(
        `UPDATE local_jobs SET status = 'pending', paused = 1, pause_requested = 0,
           lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           error_message = NULL, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ? AND pause_requested = 1`
      )
      .run(now, id, owner).changes === 1
  )
}

export function completePartialLocalJob(
  database: DatabaseSync,
  id: string,
  owner: string,
  result: CrawlProgress,
  contentBytes: number
): boolean {
  const now = new Date().toISOString()
  return (
    database
      .prepare(
        `UPDATE local_jobs SET status = 'completed', partial = 1, stop_requested = 0,
           finished_at = ?, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           result_json = ?, content_bytes = ?, error_message = NULL, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?
           AND stop_requested = 1 AND cancel_requested = 0`
      )
      .run(now, JSON.stringify(result), Math.max(0, Math.trunc(contentBytes)), now, id, owner)
      .changes === 1
  )
}

export function readLocalJobResumeUrls(database: DatabaseSync, id: string): string[] {
  const row = database
    .prepare('SELECT resume_urls_json FROM local_jobs WHERE id = ?')
    .get(id) as unknown as { resume_urls_json: string | null } | undefined
  return parseResumeUrls(row?.resume_urls_json ?? null)
}

export function recoverExpiredJobs(database: DatabaseSync, now: Date): void {
  const timestamp = now.toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET status = 'cancelled', finished_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, heartbeat_at = NULL, error_message = '任务已取消',
         result_json = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 1`
    )
    .run(timestamp, timestamp, timestamp)
  cleanupCancelledSources(database)
  database
    .prepare(
      `UPDATE local_jobs SET status = 'pending', paused = 1, pause_requested = 0,
         lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
         error_message = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND pause_requested = 1`
    )
    .run(timestamp, timestamp)
  database
    .prepare(
      `UPDATE local_jobs SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         heartbeat_at = NULL, finished_at = NULL,
         error_message = '执行进程意外退出，任务等待恢复', updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 0
         AND pause_requested = 0 AND attempt_count < 3`
    )
    .run(timestamp, timestamp)
  database
    .prepare(
      `UPDATE local_jobs SET status = 'failed', finished_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, heartbeat_at = NULL,
         error_message = '后台任务连续中断，已停止自动恢复', updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 0
         AND pause_requested = 0 AND attempt_count >= 3`
    )
    .run(timestamp, timestamp, timestamp)
}

export function finishLocalJob(
  database: DatabaseSync,
  id: string,
  owner: string,
  status: 'completed' | 'failed',
  error: string | null,
  result: CrawlProgress | null
): boolean {
  const now = new Date().toISOString()
  const changed =
    database
      .prepare(
        `UPDATE local_jobs SET status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE ? END,
           finished_at = ?, lease_owner = NULL, lease_expires_at = NULL,
           error_message = CASE WHEN cancel_requested = 1 THEN '任务已取消' ELSE ? END,
           result_json = CASE WHEN cancel_requested = 1 THEN NULL ELSE ? END, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .run(status, now, error, result ? JSON.stringify(result) : null, now, id, owner).changes === 1
  if (changed) cleanupCancelledSources(database)
  return changed
}

export function toLocalJob(row: LocalJobRow): LocalJob {
  return {
    id: row.id,
    kind: row.kind,
    resourceKey: row.resource_key,
    sourceId: row.source_id,
    hostname: row.hostname,
    trigger: row.trigger,
    status: row.status,
    priority: Number(row.priority),
    paused: Boolean(row.paused),
    pauseRequested: Boolean(row.pause_requested),
    stopRequested: Boolean(row.stop_requested),
    partial: Boolean(row.partial),
    contentBytes: Number(row.content_bytes),
    remainingCount: parseResumeUrls(row.resume_urls_json).length,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    attemptCount: Number(row.attempt_count),
    cancelRequested: Boolean(row.cancel_requested),
    error: row.error_message,
    result: parseJson<CrawlProgress | null>(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseResumeUrls(value: string | null): string[] {
  const parsed = parseJson<unknown>(value, [])
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : []
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
