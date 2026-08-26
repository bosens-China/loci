import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  getUpcomingScheduleRuns,
  type CrawlProgress,
  type EnqueueLocalJobResult,
  type LocalJob,
  type LocalJobKind,
  type LocalJobStatus,
  type LocalJobTrigger
} from '@loci/shared'
import { addColumn, withImmediateTransaction } from './sqlite.js'

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
    scheduledAt?: Date
  ) => EnqueueLocalJobResult
  refreshSourceSchedules: (now?: Date) => void
  enqueueDueSourceSchedules: (now?: Date) => EnqueueLocalJobResult[]
  claimNextLocalJob: (owner: string, leaseMs: number, now?: Date) => LocalJob | undefined
  heartbeatLocalJob: (id: string, owner: string, leaseMs: number, now?: Date) => boolean
  completeLocalJob: (id: string, owner: string, result: CrawlProgress) => boolean
  failLocalJob: (id: string, owner: string, error: string) => boolean
  releaseLocalJob: (id: string, owner: string, reason: string) => boolean
  requestLocalJobCancellation: (id: string) => LocalJob | undefined
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
}

export function createLocalJobDatabase(database: DatabaseSync): LocalJobDatabase {
  const getLocalJob = (id: string): LocalJob | undefined => {
    const row = database.prepare(`${jobQuery} WHERE id = ?`).get(id) as unknown as
      LocalJobRow | undefined
    return row ? toLocalJob(row) : undefined
  }

  const enqueueSourceSync = (
    sourceId: string,
    trigger: LocalJobTrigger,
    scheduledAt = new Date()
  ): EnqueueLocalJobResult =>
    withImmediateTransaction(database, () =>
      enqueueSourceSyncInTransaction(database, sourceId, trigger, scheduledAt)
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
            `${jobQuery} WHERE status = 'pending' AND cancel_requested = 0 AND scheduled_at <= ?
             ORDER BY scheduled_at, created_at LIMIT 1`
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
    releaseLocalJob: (id, owner, reason) => {
      const now = new Date().toISOString()
      return (
        database
          .prepare(
            `UPDATE local_jobs SET
               status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE 'pending' END,
               scheduled_at = ?,
               finished_at = CASE WHEN cancel_requested = 1 THEN ? ELSE NULL END,
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               error_message = CASE WHEN cancel_requested = 1 THEN '任务已取消' ELSE ? END,
               result_json = NULL, updated_at = ?
             WHERE id = ? AND status = 'running' AND lease_owner = ?`
          )
          .run(now, now, reason, now, id, owner).changes === 1
      )
    },
    requestLocalJobCancellation: (id) => {
      const now = new Date().toISOString()
      database
        .prepare(
          `UPDATE local_jobs SET
             cancel_requested = 1,
             status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
             finished_at = CASE WHEN status = 'pending' THEN ? ELSE finished_at END,
             error_message = CASE WHEN status = 'pending' THEN '任务已取消' ELSE NULL END,
             result_json = NULL,
             updated_at = ?
           WHERE id = ? AND status IN ('pending', 'running')`
        )
        .run(now, now, id)
      return getLocalJob(id)
    },
    getLocalJob,
    listLocalJobs: (limit = 100) => {
      const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
      const rows = database
        .prepare(`${jobQuery} ORDER BY created_at DESC LIMIT ?`)
        .all(safeLimit) as unknown as LocalJobRow[]
      return rows.map(toLocalJob)
    }
  }
}

function enqueueSourceSyncInTransaction(
  database: DatabaseSync,
  sourceId: string,
  trigger: LocalJobTrigger,
  scheduledAt: Date
): EnqueueLocalJobResult {
  const resourceKey = `source:${sourceId}`
  const existing = database
    .prepare(
      `${jobQuery} WHERE kind = 'source_sync' AND resource_key = ?
       AND status IN ('pending', 'running') LIMIT 1`
    )
    .get(resourceKey) as unknown as LocalJobRow | undefined
  if (existing) return { job: toLocalJob(existing), reused: true }
  const id = randomUUID()
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO local_jobs
       (id, kind, resource_key, source_id, trigger, status, scheduled_at, created_at, updated_at)
       VALUES (?, 'source_sync', ?, ?, ?, 'pending', ?, ?, ?)`
    )
    .run(id, resourceKey, sourceId, trigger, scheduledAt.toISOString(), now, now)
  const row = database.prepare(`${jobQuery} WHERE id = ?`).get(id) as unknown as LocalJobRow
  return { job: toLocalJob(row), reused: false }
}

function recoverExpiredJobs(database: DatabaseSync, now: Date): void {
  const timestamp = now.toISOString()
  database
    .prepare(
      `UPDATE local_jobs SET status = 'cancelled', finished_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, heartbeat_at = NULL, error_message = '任务已取消',
         result_json = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 1`
    )
    .run(timestamp, timestamp, timestamp)
  database
    .prepare(
      `UPDATE local_jobs SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         heartbeat_at = NULL, finished_at = NULL,
         error_message = '上一次执行进程已退出，任务等待重试',
         result_json = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 0
         AND attempt_count < 3`
    )
    .run(timestamp, timestamp)
  database
    .prepare(
      `UPDATE local_jobs SET status = 'failed', finished_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, heartbeat_at = NULL,
         error_message = '后台任务连续中断，已停止自动重试',
         result_json = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested = 0
         AND attempt_count >= 3`
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
  return (
    database
      .prepare(
        `UPDATE local_jobs SET status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE ? END,
           finished_at = ?, lease_owner = NULL, lease_expires_at = NULL,
           error_message = CASE WHEN cancel_requested = 1 THEN '任务已取消' ELSE ? END,
           result_json = CASE WHEN cancel_requested = 1 THEN NULL ELSE ? END, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .run(status, now, error, result ? JSON.stringify(result) : null, now, id, owner).changes === 1
  )
}

function nextRun(schedule: string, after: Date): Date {
  const next = getUpcomingScheduleRuns(schedule, 1, after)[0]
  if (!next) throw new Error(`计划“${schedule}”没有下一次执行时间`)
  return next
}

const jobQuery = `
  SELECT id, kind, resource_key, source_id, trigger, status, scheduled_at, started_at,
    finished_at, lease_owner, lease_expires_at, heartbeat_at, attempt_count,
    cancel_requested, error_message, result_json, created_at, updated_at
  FROM local_jobs`

interface LocalJobRow {
  id: string
  kind: LocalJobKind
  resource_key: string
  source_id: string
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
  created_at: string
  updated_at: string
}

function toLocalJob(row: LocalJobRow): LocalJob {
  return {
    id: row.id,
    kind: row.kind,
    resourceKey: row.resource_key,
    sourceId: row.source_id,
    trigger: row.trigger,
    status: row.status,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    attemptCount: Number(row.attempt_count),
    cancelRequested: Boolean(row.cancel_requested),
    error: row.error_message,
    result: parseJobResult(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseJobResult(value: string | null): CrawlProgress | null {
  if (!value) return null
  try {
    return JSON.parse(value) as CrawlProgress
  } catch {
    return null
  }
}
