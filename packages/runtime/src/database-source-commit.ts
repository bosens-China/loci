import type { DatabaseSync } from 'node:sqlite'
import { finishCrawlRunRecord } from './crawl-history-database.js'
import { throwLocalHostnameConflict, updateResolvedSourceRecord } from './database-local-source.js'
import type { SourceCrawlCommit } from './database-types.js'
import {
  deleteSourceDocuments,
  deleteStoredDocument,
  storeDocument
} from './document-content-database.js'
import { commitExplicitPageResults } from './explicit-page-database.js'
import { completePartialLocalJob, finishLocalJob } from './local-job-record.js'
import { withImmediateTransaction } from './sqlite.js'

/** 抓取正文、来源解析结果与 URL 审查终态必须在同一事务内提交。 */
export function commitSourceCrawl(
  database: DatabaseSync,
  id: string,
  commit: SourceCrawlCommit
): boolean {
  try {
    return withImmediateTransaction(database, () => {
      if (commit.localJob && !canCompleteLocalJob(database, id, commit.localJob)) return false
      if (commit.urlReview && !claimUrlReview(database, id, commit.urlReview)) return false
      if (commit.replaceAll) {
        deleteSourceDocuments(database, id)
      } else {
        for (const url of new Set(commit.deletedUrls)) deleteStoredDocument(database, id, url)
      }
      for (const document of commit.documents) storeDocument(database, document)
      if (commit.explicitPages?.length) {
        commitExplicitPageResults(database, id, commit.explicitPages, commit.resolution.mode)
      }
      updateResolvedSourceRecord(
        database,
        id,
        commit.resolution.firstUrl,
        commit.resolution.mode,
        commit.resolution.iconUrl,
        commit.resolution.github,
        commit.resolution.discovery
      )
      if (commit.urlReview) {
        database
          .prepare('UPDATE url_review_candidates SET document_json = NULL WHERE run_id = ?')
          .run(commit.urlReview.runId)
      }
      if (commit.localJob) {
        if (
          !finishCrawlRunRecord(
            database,
            commit.localJob.runId,
            'completed',
            commit.localJob.result,
            null
          )
        ) {
          throw new Error('抓取运行提交状态已变化')
        }
        const finished = commit.localJob.partial
          ? completePartialLocalJob(
              database,
              commit.localJob.id,
              commit.localJob.owner,
              commit.localJob.result,
              commit.localJob.contentBytes ?? 0
            )
          : finishLocalJob(
              database,
              commit.localJob.id,
              commit.localJob.owner,
              'completed',
              null,
              commit.localJob.result
            )
        if (!finished) {
          throw new Error('持久任务提交状态已变化')
        }
      }
      return true
    })
  } catch (error) {
    throwLocalHostnameConflict(error)
  }
}

function canCompleteLocalJob(
  database: DatabaseSync,
  sourceId: string,
  job: NonNullable<SourceCrawlCommit['localJob']>
): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM local_jobs AS job
         JOIN crawl_runs AS run ON run.id = ? AND run.source_id = job.source_id
         WHERE job.id = ? AND job.source_id = ? AND job.status = 'running'
           AND job.lease_owner = ? AND job.cancel_requested = 0 AND run.status = 'running'
           AND ((? = 1 AND job.stop_requested = 1) OR (? = 0 AND job.stop_requested = 0))`
      )
      .get(job.runId, job.id, sourceId, job.owner, job.partial ? 1 : 0, job.partial ? 1 : 0)
  )
}

function claimUrlReview(
  database: DatabaseSync,
  sourceId: string,
  review: NonNullable<SourceCrawlCommit['urlReview']>
): boolean {
  const now = new Date().toISOString()
  const result = database
    .prepare(
      `UPDATE url_review_runs SET status = 'completed', limit_reached = ?,
         finished_at = ?, updated_at = ?
       WHERE id = ? AND source_id = ? AND status = 'discovering'`
    )
    .run(review.limitReached ? 1 : 0, now, now, review.runId, sourceId)
  return result.changes === 1
}
