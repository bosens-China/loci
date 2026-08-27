import type { DatabaseSync } from 'node:sqlite'
import type { LocalJob } from '@loci/shared'
import { withImmediateTransaction } from './sqlite.js'

type GetLocalJob = (id: string) => LocalJob | undefined

/** 取消任务时丢弃本次检查点；由新建文档库触发的首个任务还会删除空库。 */
export function requestLocalJobCancellation(
  database: DatabaseSync,
  id: string,
  getLocalJob: GetLocalJob
): LocalJob | undefined {
  return withImmediateTransaction(database, () => {
    const now = new Date().toISOString()
    database
      .prepare(
        `UPDATE local_jobs SET
           cancel_requested = 1,
           status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
           finished_at = CASE WHEN status = 'pending' THEN ? ELSE finished_at END,
           error_message = CASE WHEN status = 'pending' THEN '任务已取消' ELSE NULL END,
           result_json = NULL, resume_urls_json = NULL, content_bytes = 0,
           updated_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`
      )
      .run(now, now, id)
    const job = getLocalJob(id)
    if (job?.status === 'cancelled') cleanupCancelledSource(database, id)
    return job
  })
}

export function releaseCancelledOrPendingJob(
  database: DatabaseSync,
  id: string,
  owner: string,
  reason: string
): boolean {
  return withImmediateTransaction(database, () => {
    const now = new Date().toISOString()
    const changed =
      database
        .prepare(
          `UPDATE local_jobs SET
             status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE 'pending' END,
             scheduled_at = ?,
             finished_at = CASE WHEN cancel_requested = 1 THEN ? ELSE NULL END,
             lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
             error_message = CASE WHEN cancel_requested = 1 THEN '任务已取消' ELSE ? END,
             result_json = CASE WHEN cancel_requested = 1 THEN NULL ELSE result_json END,
             resume_urls_json = CASE WHEN cancel_requested = 1 THEN NULL ELSE resume_urls_json END,
             content_bytes = CASE WHEN cancel_requested = 1 THEN 0 ELSE content_bytes END,
             updated_at = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(now, now, reason, now, id, owner).changes === 1
    if (changed) cleanupCancelledSource(database, id)
    return changed
  })
}

export function cleanupCancelledSources(database: DatabaseSync): void {
  database.exec(`
    DELETE FROM document_sources
    WHERE id IN (
      SELECT source_id FROM local_jobs
      WHERE status = 'cancelled' AND delete_source_on_cancel = 1
    )
  `)
}

function cleanupCancelledSource(database: DatabaseSync, jobId: string): void {
  database
    .prepare(
      `DELETE FROM document_sources
       WHERE id IN (
         SELECT source_id FROM local_jobs
         WHERE id = ? AND status = 'cancelled' AND delete_source_on_cancel = 1
       )`
    )
    .run(jobId)
}
