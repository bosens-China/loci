import type { DatabaseSync } from 'node:sqlite'
import type { CrawlNode, CrawlProgress, LocalJobEvent, LocalJobEventStatus } from '@loci/shared'
import { withImmediateTransaction } from './sqlite.js'

export interface LocalJobEventDatabase {
  recordLocalJobProgress: (
    jobId: string,
    owner: string,
    progress: CrawlProgress,
    runId?: string
  ) => LocalJobEvent | undefined
  listLocalJobEvents: (jobId: string, afterSequence?: number, limit?: number) => LocalJobEvent[]
}

export function initializeLocalJobEventDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_job_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES local_jobs(id) ON DELETE CASCADE,
      run_id TEXT,
      node_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
      progress_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, node_id, status)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS local_job_events_follow
      ON local_job_events(job_id, sequence);
  `)
}

export function createLocalJobEventDatabase(database: DatabaseSync): LocalJobEventDatabase {
  return {
    recordLocalJobProgress: (jobId, owner, progress, runId) =>
      withImmediateTransaction(database, () => {
        const now = new Date().toISOString()
        const updated = database
          .prepare(
            `UPDATE local_jobs SET result_json = ?, updated_at = ?
             WHERE id = ? AND status = 'running' AND lease_owner = ? AND cancel_requested = 0`
          )
          .run(JSON.stringify(progress), now, jobId, owner)
        if (updated.changes !== 1 || !isCompletedNode(progress.node)) return undefined
        const aggregate = { ...progress }
        delete aggregate.node
        const inserted = database
          .prepare(
            `INSERT OR IGNORE INTO local_job_events
             (job_id, run_id, node_id, url, title, status, progress_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            runId ?? null,
            progress.node.id,
            progress.node.url,
            progress.node.title,
            progress.node.status,
            JSON.stringify(aggregate),
            now
          )
        if (inserted.changes !== 1) return undefined
        const row = database
          .prepare(`${eventQuery} WHERE e.sequence = ?`)
          .get(inserted.lastInsertRowid) as unknown as LocalJobEventRow
        return toLocalJobEvent(row)
      }),
    listLocalJobEvents: (jobId, afterSequence = 0, limit = 100) => {
      const safeAfter = Math.max(0, Math.trunc(afterSequence))
      const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
      const rows = database
        .prepare(`${eventQuery} WHERE e.job_id = ? AND e.sequence > ? ORDER BY e.sequence LIMIT ?`)
        .all(jobId, safeAfter, safeLimit) as unknown as LocalJobEventRow[]
      return rows.map(toLocalJobEvent)
    }
  }
}

function isCompletedNode(
  node: CrawlNode | undefined
): node is CrawlNode & { status: LocalJobEventStatus } {
  return node?.status === 'success' || node?.status === 'failed'
}

function toLocalJobEvent(row: LocalJobEventRow): LocalJobEvent {
  const progress = parseProgress(row.progress_json)
  const node: CrawlNode & { status: LocalJobEventStatus } = {
    id: row.node_id,
    url: row.url,
    title: row.title,
    status: row.status
  }
  return {
    sequence: Number(row.sequence),
    jobId: row.job_id,
    sourceId: row.source_id,
    runId: row.run_id,
    node,
    progress: { ...progress, node },
    createdAt: row.created_at
  }
}

function parseProgress(value: string): CrawlProgress {
  try {
    return JSON.parse(value) as CrawlProgress
  } catch {
    return { queued: 0, processed: 0, succeeded: 0, failed: 0, limitReached: false }
  }
}

interface LocalJobEventRow {
  sequence: number
  job_id: string
  source_id: string
  run_id: string | null
  node_id: string
  url: string
  title: string
  status: LocalJobEventStatus
  progress_json: string
  created_at: string
}

const eventQuery = `SELECT e.sequence, e.job_id, j.source_id, e.run_id, e.node_id,
  e.url, e.title, e.status, e.progress_json, e.created_at
  FROM local_job_events e JOIN local_jobs j ON j.id = e.job_id`
