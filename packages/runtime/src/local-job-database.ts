import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  getUpcomingScheduleRuns,
  type CrawlProgress,
  type EnqueueLocalJobResult,
  type LocalJob,
  type LocalJobTrigger
} from '@loci/shared'
import { addColumn, withImmediateTransaction } from './sqlite.js'
import {
  releaseCancelledOrPendingJob,
  requestLocalJobCancellation
} from './local-job-cancellation.js'
import {
  LOCAL_JOB_QUERY,
  type LocalJobRow,
  checkpointLocalJob,
  completePartialLocalJob,
  finishLocalJob,
  initializeLocalJobControlColumns,
  pauseLocalJob,
  pauseLocalJobs,
  promoteHostnameJob,
  recoverExpiredJobs,
  readLocalJobResumeUrls,
  releasePausedLocalJob,
  resumeLocalJob,
  resumeLocalJobs,
  setLocalJobPriority,
  stopLocalJob,
  toLocalJob
} from './local-job-record.js'

export { finishLocalJob } from './local-job-record.js'

export type {
  EnqueueLocalJobResult,
  LocalJob,
  LocalJobKind,
  LocalJobStatus,
  LocalJobTrigger
} from '@loci/shared'

export interface LocalJobDatabase {
  enqueueSourceSync: (
    sourceId: string,
    trigger: LocalJobTrigger,
    scheduledAt?: Date,
    options?: { deleteSourceOnCancel?: boolean }
  ) => EnqueueLocalJobResult
  refreshSourceSchedules: (now?: Date) => void
  enqueueDueSourceSchedules: (now?: Date) => EnqueueLocalJobResult[]
  claimNextLocalJob: (owner: string, leaseMs: number, now?: Date) => LocalJob | undefined
  heartbeatLocalJob: (id: string, owner: string, leaseMs: number, now?: Date) => boolean
  completeLocalJob: (id: string, owner: string, result: CrawlProgress) => boolean
  failLocalJob: (id: string, owner: string, error: string) => boolean
  releaseLocalJob: (id: string, owner: string, reason: string) => boolean
  requestLocalJobCancellation: (id: string) => LocalJob | undefined
  requestLocalJobPause: (id: string) => LocalJob | undefined
  resumeLocalJob: (id: string) => LocalJob | undefined
  pauseLocalJobs: (hostname?: string) => number
  resumeLocalJobs: (hostname?: string) => number
  requestLocalJobStop: (id: string) => LocalJob | undefined
  setLocalJobPriority: (id: string, priority: number) => LocalJob | undefined
  releasePausedLocalJob: (id: string, owner: string) => boolean
  completePartialLocalJob: (
    id: string,
    owner: string,
    result: CrawlProgress,
    contentBytes: number
  ) => boolean
  checkpointLocalJob: (
    id: string,
    owner: string,
    progress: CrawlProgress,
    pendingUrls: readonly string[],
    contentBytes: number
  ) => boolean
  getLocalJobResumeUrls: (id: string) => string[]
  getLocalJob: (id: string) => LocalJob | undefined
  listLocalJobs: (limit?: number) => LocalJob[]
}

export function initializeLocalJobDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('source_sync')),
      resource_key TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'background', 'schedule', 'ui', 'mcp')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      scheduled_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
      error_message TEXT,
      result_json TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
      pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0, 1)),
      stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
      partial INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
      content_bytes INTEGER NOT NULL DEFAULT 0,
      resume_urls_json TEXT,
      delete_source_on_cancel INTEGER NOT NULL DEFAULT 0 CHECK (delete_source_on_cancel IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS local_jobs_active_resource
      ON local_jobs(kind, resource_key)
      WHERE status IN ('pending', 'running');

    CREATE INDEX IF NOT EXISTS local_jobs_claim_order
      ON local_jobs(status, scheduled_at, created_at);

    CREATE TABLE IF NOT EXISTS local_source_schedules (
      source_id TEXT PRIMARY KEY REFERENCES document_sources(id) ON DELETE CASCADE,
      schedule TEXT NOT NULL,
      next_run_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `)
  addColumn(database, 'local_jobs', 'result_json', 'TEXT')
  initializeLocalJobControlColumns(database)
}

export function createLocalJobDatabase(database: DatabaseSync): LocalJobDatabase {
  const getLocalJob = (id: string): LocalJob | undefined => {
    const row = database.prepare(`${LOCAL_JOB_QUERY} WHERE job.id = ?`).get(id) as unknown as
      LocalJobRow | undefined
    return row ? toLocalJob(row) : undefined
  }

  const enqueueSourceSync = (
    sourceId: string,
    trigger: LocalJobTrigger,
    scheduledAt = new Date(),
    options?: { deleteSourceOnCancel?: boolean }
  ): EnqueueLocalJobResult =>
    withImmediateTransaction(database, () =>
      enqueueSourceSyncInTransaction(database, sourceId, trigger, scheduledAt, options)
    )

  return {
    enqueueSourceSync,
    refreshSourceSchedules: (now = new Date()) => {
      withImmediateTransaction(database, () => {
        const sources = database
          .prepare(
            `SELECT id, schedule FROM document_sources
             WHERE source_type = 'local' AND schedule IS NOT NULL`
          )
          .all() as unknown as Array<{ id: string; schedule: string }>
        const activeIds = new Set(sources.map((source) => source.id))
        const states = database
          .prepare('SELECT source_id, schedule FROM local_source_schedules')
          .all() as unknown as Array<{ source_id: string; schedule: string }>
        const remove = database.prepare('DELETE FROM local_source_schedules WHERE source_id = ?')
        for (const state of states) {
          if (!activeIds.has(state.source_id)) remove.run(state.source_id)
        }
        const upsert = database.prepare(
          `INSERT INTO local_source_schedules (source_id, schedule, next_run_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             schedule = excluded.schedule,
             next_run_at = excluded.next_run_at,
             updated_at = excluded.updated_at
           WHERE local_source_schedules.schedule <> excluded.schedule`
        )
        for (const source of sources) {
          upsert.run(
            source.id,
            source.schedule,
            nextRun(source.schedule, now).toISOString(),
            now.toISOString()
          )
        }
      })
    },
    enqueueDueSourceSchedules: (now = new Date()) =>
      withImmediateTransaction(database, () => {
        const due = database
          .prepare(
            `SELECT source_id, schedule, next_run_at FROM local_source_schedules
             WHERE next_run_at <= ? ORDER BY next_run_at`
          )
          .all(now.toISOString()) as unknown as Array<{
          source_id: string
          schedule: string
          next_run_at: string
        }>
        const update = database.prepare(
          `UPDATE local_source_schedules SET next_run_at = ?, updated_at = ? WHERE source_id = ?`
        )
        const results: EnqueueLocalJobResult[] = []
        for (const state of due) {
          results.push(
            enqueueSourceSyncInTransaction(
              database,
              state.source_id,
              'schedule',
              new Date(state.next_run_at)
            )
          )
          update.run(nextRun(state.schedule, now).toISOString(), now.toISOString(), state.source_id)
        }
        return results
      }),
    claimNextLocalJob: (owner, leaseMs, now = new Date()) =>
      withImmediateTransaction(database, () => {
        recoverExpiredJobs(database, now)
        const row = database
          .prepare(
            `${LOCAL_JOB_QUERY} WHERE job.status = 'pending' AND job.cancel_requested = 0
             AND job.paused = 0 AND job.pause_requested = 0 AND job.stop_requested = 0
             AND job.scheduled_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM local_jobs AS active_job
               JOIN document_sources AS active_source ON active_source.id = active_job.source_id
               WHERE active_job.status = 'running' AND active_source.hostname = source.hostname
             )
             ORDER BY job.priority DESC, job.scheduled_at, job.created_at LIMIT 1`
          )
          .get(now.toISOString()) as unknown as LocalJobRow | undefined
        if (!row) return undefined
        const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString()
        const result = database
          .prepare(
            `UPDATE local_jobs SET status = 'running', started_at = COALESCE(started_at, ?),
               lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
               attempt_count = attempt_count + 1, finished_at = NULL,
               error_message = NULL, result_json = NULL, updated_at = ?
             WHERE id = ? AND status = 'pending'`
          )
          .run(
            now.toISOString(),
            owner,
            leaseExpiresAt,
            now.toISOString(),
            now.toISOString(),
            row.id
          )
        return result.changes === 1 ? getLocalJob(row.id) : undefined
      }),
    heartbeatLocalJob: (id, owner, leaseMs, now = new Date()) =>
      database
        .prepare(
          `UPDATE local_jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(
          now.toISOString(),
          new Date(now.getTime() + leaseMs).toISOString(),
          now.toISOString(),
          id,
          owner
        ).changes === 1,
    completeLocalJob: (id, owner, result) =>
      finishLocalJob(database, id, owner, 'completed', null, result),
    failLocalJob: (id, owner, error) => finishLocalJob(database, id, owner, 'failed', error, null),
    releaseLocalJob: (id, owner, reason) =>
      releaseCancelledOrPendingJob(database, id, owner, reason),
    requestLocalJobCancellation: (id) => requestLocalJobCancellation(database, id, getLocalJob),
    requestLocalJobPause: (id) => pauseLocalJob(database, id, getLocalJob),
    resumeLocalJob: (id) =>
      withImmediateTransaction(database, () => resumeLocalJob(database, id, getLocalJob)),
    pauseLocalJobs: (hostname) =>
      withImmediateTransaction(database, () => pauseLocalJobs(database, hostname)),
    resumeLocalJobs: (hostname) =>
      withImmediateTransaction(database, () => resumeLocalJobs(database, hostname)),
    requestLocalJobStop: (id) => stopLocalJob(database, id, getLocalJob),
    setLocalJobPriority: (id, priority) => setLocalJobPriority(database, id, priority, getLocalJob),
    releasePausedLocalJob: (id, owner) => releasePausedLocalJob(database, id, owner),
    completePartialLocalJob: (id, owner, result, contentBytes) =>
      completePartialLocalJob(database, id, owner, result, contentBytes),
    checkpointLocalJob: (id, owner, progress, pendingUrls, contentBytes) =>
      checkpointLocalJob(database, id, owner, progress, pendingUrls, contentBytes),
    getLocalJobResumeUrls: (id) => readLocalJobResumeUrls(database, id),
    getLocalJob,
    listLocalJobs: (limit = 100) => {
      const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
      const rows = database
        .prepare(`${LOCAL_JOB_QUERY} ORDER BY job.created_at DESC LIMIT ?`)
        .all(safeLimit) as unknown as LocalJobRow[]
      return rows.map(toLocalJob)
    }
  }
}

function enqueueSourceSyncInTransaction(
  database: DatabaseSync,
  sourceId: string,
  trigger: LocalJobTrigger,
  scheduledAt: Date,
  options?: { deleteSourceOnCancel?: boolean }
): EnqueueLocalJobResult {
  const resourceKey = `source:${sourceId}`
  const existing = database
    .prepare(
      `${LOCAL_JOB_QUERY} WHERE job.kind = 'source_sync' AND job.resource_key = ?
       AND job.status IN ('pending', 'running') LIMIT 1`
    )
    .get(resourceKey) as unknown as LocalJobRow | undefined
  if (existing) {
    if (trigger === 'ui') promoteHostnameJob(database, existing.id, sourceId, scheduledAt)
    const current = database
      .prepare(`${LOCAL_JOB_QUERY} WHERE job.id = ?`)
      .get(existing.id) as unknown as LocalJobRow
    return { job: toLocalJob(current), reused: true }
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  const previous = database
    .prepare(
      `SELECT partial, resume_urls_json FROM local_jobs
       WHERE source_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`
    )
    .get(sourceId) as unknown as { partial: number; resume_urls_json: string | null } | undefined
  const resumeUrls = previous?.partial ? previous.resume_urls_json : null
  database
    .prepare(
      `INSERT INTO local_jobs
       (id, kind, resource_key, source_id, trigger, status, priority, scheduled_at,
        resume_urls_json, delete_source_on_cancel, created_at, updated_at)
       VALUES (?, 'source_sync', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      resourceKey,
      sourceId,
      trigger,
      trigger === 'ui' ? 100 : 0,
      scheduledAt.toISOString(),
      resumeUrls,
      options?.deleteSourceOnCancel ? 1 : 0,
      now,
      now
    )
  if (trigger === 'ui') promoteHostnameJob(database, id, sourceId, scheduledAt)
  const row = database
    .prepare(`${LOCAL_JOB_QUERY} WHERE job.id = ?`)
    .get(id) as unknown as LocalJobRow
  return { job: toLocalJob(row), reused: false }
}

function nextRun(schedule: string, after: Date): Date {
  const next = getUpcomingScheduleRuns(schedule, 1, after)[0]
  if (!next) throw new Error(`计划“${schedule}”没有下一次执行时间`)
  return next
}
