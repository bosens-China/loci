import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawledDocument, CrawlFailure } from '@loci/core'
import { withTransaction } from './database-local-source.js'
import type {
  UrlReviewCandidate,
  UrlReviewCandidateInput,
  UrlReviewDiscovery,
  UrlReviewRun,
  UrlReviewSnapshot,
  UrlReviewStatus,
  UrlReviewTitleSource
} from './url-review-types.js'
export { initializeUrlReviewDatabase } from './url-review-schema.js'

export type {
  UrlReviewCandidate,
  UrlReviewCandidateInput,
  UrlReviewDiscovery,
  UrlReviewRun,
  UrlReviewSnapshot,
  UrlReviewStatus,
  UrlReviewTitleSource
} from './url-review-types.js'

export interface UrlReviewDatabase {
  startUrlReview: (sourceId: string, goal: string, firstUrl: string) => UrlReviewRun
  getUrlReview: (runId: string) => UrlReviewRun | undefined
  getActiveUrlReview: (sourceId: string) => UrlReviewRun | undefined
  updateUrlReviewDiscovery: (
    runId: string,
    discovery: Exclude<UrlReviewDiscovery, 'new'>,
    fetchMode: UrlReviewRun['fetchMode'],
    firstUrl: string,
    iconUrl: string | null
  ) => void
  addUrlReviewCandidates: (runId: string, candidates: readonly UrlReviewCandidateInput[]) => void
  assignUrlReviewBatch: (runId: string, limit: number) => UrlReviewSnapshot
  submitUrlReviewBatch: (runId: string, batchId: string, excludeUrls: readonly string[]) => boolean
  listApprovedUrlReviewCandidates: (runId: string) => UrlReviewCandidate[]
  completeUrlReviewCandidate: (
    candidateId: string,
    document: CrawledDocument | undefined,
    failure: CrawlFailure | undefined,
    discovered: readonly UrlReviewCandidateInput[]
  ) => void
  listUrlReviewDocuments: (runId: string) => CrawledDocument[]
  listUrlReviewDeletedUrls: (runId: string) => string[]
  listUrlReviewFailures: (runId: string) => CrawlFailure[]
  getUrlReviewSnapshot: (runId: string) => UrlReviewSnapshot | undefined
  finishUrlReview: (runId: string, limitReached: boolean) => void
  failUrlReview: (runId: string, error: string) => void
  cancelUrlReview: (runId: string) => boolean
}

interface RunRow {
  id: string
  source_id: string
  goal: string
  status: UrlReviewStatus
  discovery: UrlReviewDiscovery
  fetch_mode: UrlReviewRun['fetchMode']
  first_url: string
  icon_url: string | null
  limit_reached: number
  error_message: string | null
}

interface CandidateRow {
  id: string
  run_id: string
  url: string
  title: string
  title_source: UrlReviewTitleSource
  discovered_from: string | null
  decision: UrlReviewCandidate['decision']
  batch_id: string | null
  processed_at: string | null
  document_json: string | null
  failure_json: string | null
}

export function createUrlReviewDatabase(database: DatabaseSync): UrlReviewDatabase {
  const readRun = (runId: string): UrlReviewRun | undefined => {
    const row = database.prepare('SELECT * FROM url_review_runs WHERE id = ?').get(runId) as
      RunRow | undefined
    return row ? toRun(row) : undefined
  }
  const snapshot = (runId: string): UrlReviewSnapshot | undefined => {
    const run = readRun(runId)
    if (!run) return undefined
    const rows = database
      .prepare('SELECT * FROM url_review_candidates WHERE run_id = ? ORDER BY rowid')
      .all(runId) as unknown as CandidateRow[]
    const candidates = rows.map(toCandidate)
    const current = candidates.filter(
      (item) =>
        item.batchId &&
        item.batchId ===
          candidates.find((entry) => entry.decision === 'pending' && entry.batchId)?.batchId
    )
    return {
      run,
      ...(current[0]?.batchId ? { batchId: current[0].batchId } : {}),
      candidates: current,
      discoveredCount: candidates.length,
      approvedCount: candidates.filter((item) => item.decision === 'approved').length,
      excludedCount: candidates.filter((item) => item.decision === 'excluded').length,
      processedCount: candidates.filter((item) => item.processed).length,
      failedCount: candidates.filter((item) => item.failure).length
    }
  }

  return {
    startUrlReview: (sourceId, goal, firstUrl) =>
      withTransaction(database, () => {
        const active = database
          .prepare(
            "SELECT * FROM url_review_runs WHERE source_id = ? AND status IN ('discovering', 'awaiting_review')"
          )
          .get(sourceId) as RunRow | undefined
        if (active) return toRun(active)
        const id = randomUUID()
        const now = new Date().toISOString()
        database
          .prepare(
            `INSERT INTO url_review_runs
             (id, source_id, goal, status, discovery, fetch_mode, first_url, created_at, updated_at)
             VALUES (?, ?, ?, 'discovering', 'new', 'auto', ?, ?, ?)`
          )
          .run(id, sourceId, goal.trim(), firstUrl, now, now)
        return readRun(id)!
      }),
    getUrlReview: readRun,
    getActiveUrlReview: (sourceId) => {
      const row = database
        .prepare(
          "SELECT * FROM url_review_runs WHERE source_id = ? AND status IN ('discovering', 'awaiting_review')"
        )
        .get(sourceId) as RunRow | undefined
      return row ? toRun(row) : undefined
    },
    updateUrlReviewDiscovery: (runId, discovery, fetchMode, firstUrl, iconUrl) => {
      database
        .prepare(
          `UPDATE url_review_runs SET discovery = ?, fetch_mode = ?, first_url = ?,
             icon_url = COALESCE(?, icon_url), updated_at = ?
           WHERE id = ? AND status IN ('discovering', 'awaiting_review')`
        )
        .run(discovery, fetchMode, firstUrl, iconUrl, new Date().toISOString(), runId)
    },
    addUrlReviewCandidates: (runId, candidates) => insertCandidates(database, runId, candidates),
    assignUrlReviewBatch: (runId, limit) =>
      withTransaction(database, () => {
        const current = snapshot(runId)
        if (!current) throw new Error('URL 审查运行不存在')
        if (current.run.status !== 'discovering' && current.run.status !== 'awaiting_review') {
          return current
        }
        if (current.run.status === 'awaiting_review' && current.batchId) return current
        const rows = database
          .prepare(
            `SELECT id FROM url_review_candidates
             WHERE run_id = ? AND decision = 'pending' AND batch_id IS NULL ORDER BY rowid LIMIT ?`
          )
          .all(runId, Math.max(0, limit)) as unknown as Array<{ id: string }>
        if (!rows.length) return current
        const batchId = randomUUID()
        const update = database.prepare(
          'UPDATE url_review_candidates SET batch_id = ? WHERE id = ?'
        )
        for (const row of rows) update.run(batchId, row.id)
        database
          .prepare(
            "UPDATE url_review_runs SET status = 'awaiting_review', updated_at = ? WHERE id = ?"
          )
          .run(new Date().toISOString(), runId)
        return snapshot(runId)!
      }),
    submitUrlReviewBatch: (runId, batchId, excludeUrls) =>
      withTransaction(database, () => {
        const rows = database
          .prepare('SELECT * FROM url_review_candidates WHERE run_id = ? AND batch_id = ?')
          .all(runId, batchId) as unknown as CandidateRow[]
        if (!rows.length) throw new Error('URL 审查批次不存在')
        const urls = new Set(rows.map((row) => row.url))
        const excluded = new Set(excludeUrls)
        const invalid = [...excluded].find((url) => !urls.has(url))
        if (invalid) throw new Error(`排除 URL 不属于当前审查批次：${invalid}`)
        const alreadyDecided = rows.every((row) => row.decision !== 'pending')
        if (alreadyDecided) {
          const saved = new Set(
            rows.filter((row) => row.decision === 'excluded').map((row) => row.url)
          )
          if (saved.size !== excluded.size || [...saved].some((url) => !excluded.has(url))) {
            throw new Error('该批次已使用不同的排除清单提交')
          }
          return false
        }
        const run = readRun(runId)
        if (run?.status !== 'awaiting_review') throw new Error('URL 审查已经结束或不在等待审批')
        const approve = database.prepare(
          "UPDATE url_review_candidates SET decision = 'approved' WHERE run_id = ? AND batch_id = ?"
        )
        approve.run(runId, batchId)
        const reject = database.prepare(
          "UPDATE url_review_candidates SET decision = 'excluded' WHERE run_id = ? AND batch_id = ? AND url = ?"
        )
        for (const url of excluded) reject.run(runId, batchId, url)
        database
          .prepare("UPDATE url_review_runs SET status = 'discovering', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), runId)
        return true
      }),
    listApprovedUrlReviewCandidates: (runId) =>
      (
        database
          .prepare(
            "SELECT * FROM url_review_candidates WHERE run_id = ? AND decision = 'approved' AND processed_at IS NULL ORDER BY rowid"
          )
          .all(runId) as unknown as CandidateRow[]
      ).map(toCandidate),
    completeUrlReviewCandidate: (candidateId, document, failure, discovered) =>
      withTransaction(database, () => {
        const row = database
          .prepare(
            `SELECT c.run_id, r.status FROM url_review_candidates c
             JOIN url_review_runs r ON r.id = c.run_id WHERE c.id = ?`
          )
          .get(candidateId) as { run_id: string; status: UrlReviewStatus } | undefined
        if (!row) throw new Error('URL 审查候选项不存在')
        if (row.status !== 'discovering' && row.status !== 'awaiting_review') return
        insertCandidates(database, row.run_id, discovered)
        database
          .prepare(
            `UPDATE url_review_candidates SET processed_at = ?, document_json = ?, failure_json = ?
             WHERE id = ? AND processed_at IS NULL`
          )
          .run(
            new Date().toISOString(),
            document ? JSON.stringify(document) : null,
            failure ? JSON.stringify(failure) : null,
            candidateId
          )
      }),
    listUrlReviewDocuments: (runId) =>
      readCandidateRows(database, runId).flatMap((row) =>
        row.decision === 'approved' && row.processed_at !== null && row.document_json
          ? [JSON.parse(row.document_json) as CrawledDocument]
          : []
      ),
    listUrlReviewDeletedUrls: (runId) =>
      readCandidateRows(database, runId).flatMap((row) => {
        if (row.decision === 'excluded') return [row.url]
        if (row.document_json) {
          const document = JSON.parse(row.document_json) as CrawledDocument
          if (document.url !== row.url) return [row.url]
        }
        if (!row.failure_json) return []
        const failure = JSON.parse(row.failure_json) as CrawlFailure
        return failure.reason === 'not_found' ? [row.url] : []
      }),
    listUrlReviewFailures: (runId) =>
      readCandidateRows(database, runId).flatMap((row) =>
        row.failure_json ? [JSON.parse(row.failure_json) as CrawlFailure] : []
      ),
    getUrlReviewSnapshot: snapshot,
    finishUrlReview: (runId, limitReached) =>
      finish(database, runId, 'completed', null, limitReached),
    failUrlReview: (runId, error) => finish(database, runId, 'failed', error, false),
    cancelUrlReview: (runId) =>
      withTransaction(database, () => {
        const now = new Date().toISOString()
        const cancelled =
          Number(
            database
              .prepare(
                `UPDATE url_review_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
                 WHERE id = ? AND status IN ('discovering', 'awaiting_review')`
              )
              .run(now, now, runId).changes
          ) === 1
        if (cancelled) clearCachedDocuments(database, runId)
        return cancelled
      })
  }
}

function insertCandidates(
  database: DatabaseSync,
  runId: string,
  candidates: readonly UrlReviewCandidateInput[]
): void {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO url_review_candidates
     (id, run_id, url, title, title_source, discovered_from, decision, document_json, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM url_review_runs
       WHERE id = ? AND status IN ('discovering', 'awaiting_review')
     )`
  )
  const now = new Date().toISOString()
  for (const candidate of candidates) {
    insert.run(
      randomUUID(),
      runId,
      candidate.url,
      candidate.title.trim().slice(0, 300) || candidate.url,
      candidate.titleSource,
      candidate.discoveredFrom ?? null,
      candidate.decision ?? 'pending',
      candidate.document ? JSON.stringify(candidate.document) : null,
      now,
      runId
    )
  }
}

function readCandidateRows(database: DatabaseSync, runId: string): CandidateRow[] {
  return database
    .prepare('SELECT * FROM url_review_candidates WHERE run_id = ? ORDER BY rowid')
    .all(runId) as unknown as CandidateRow[]
}

function toRun(row: RunRow): UrlReviewRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    goal: row.goal,
    status: row.status,
    discovery: row.discovery,
    fetchMode: row.fetch_mode,
    firstUrl: row.first_url,
    iconUrl: row.icon_url,
    limitReached: Boolean(row.limit_reached),
    error: row.error_message
  }
}

function toCandidate(row: CandidateRow): UrlReviewCandidate {
  return {
    id: row.id,
    runId: row.run_id,
    url: row.url,
    title: row.title,
    titleSource: row.title_source,
    ...(row.discovered_from ? { discoveredFrom: row.discovered_from } : {}),
    decision: row.decision,
    batchId: row.batch_id,
    processed: row.processed_at !== null,
    ...(row.document_json ? { document: JSON.parse(row.document_json) as CrawledDocument } : {}),
    ...(row.failure_json ? { failure: JSON.parse(row.failure_json) as CrawlFailure } : {})
  }
}

function finish(
  database: DatabaseSync,
  runId: string,
  status: 'completed' | 'failed',
  error: string | null,
  limitReached: boolean
): void {
  withTransaction(database, () => {
    const now = new Date().toISOString()
    const changed = database
      .prepare(
        `UPDATE url_review_runs SET status = ?, error_message = ?, limit_reached = ?,
           finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('discovering', 'awaiting_review')`
      )
      .run(status, error, limitReached ? 1 : 0, now, now, runId).changes
    if (changed) clearCachedDocuments(database, runId)
  })
}

function clearCachedDocuments(database: DatabaseSync, runId: string): void {
  database
    .prepare('UPDATE url_review_candidates SET document_json = NULL WHERE run_id = ?')
    .run(runId)
}
