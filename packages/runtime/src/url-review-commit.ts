import type { LociDatabase, SourceConfig } from './database.js'
import type { UrlReviewRun } from './url-review-types.js'

export function commitUrlReview(
  database: LociDatabase,
  run: UrlReviewRun,
  source: SourceConfig,
  limitReached: boolean
): boolean {
  const documents = database
    .listUrlReviewDocuments(run.id)
    .map((document) => ({ ...document, sourceId: source.id }))
  const resolved = database.getUrlReview(run.id)
  if (!resolved) throw new Error('URL 审查运行不存在')
  if (resolved.status !== 'discovering') return false
  const mode = resolved.fetchMode === 'auto' ? 'http' : resolved.fetchMode
  const committed = database.commitSourceCrawl(source.id, {
    documents,
    deletedUrls: database.listUrlReviewDeletedUrls(run.id),
    replaceAll: false,
    urlReview: { runId: run.id, limitReached },
    resolution: {
      firstUrl: resolved.firstUrl,
      mode,
      iconUrl: resolved.iconUrl,
      discovery: resolvedDiscovery(resolved.discovery)
    }
  })
  if (!committed) return false
  const failures = database.listUrlReviewFailures(run.id)
  const snapshot = database.getUrlReviewSnapshot(run.id)
  if (!snapshot) throw new Error('URL 审查运行不存在')
  const crawlRunId = database.startCrawlRun(source.id)
  database.finishCrawlRun(
    crawlRunId,
    'completed',
    {
      queued: snapshot.discoveredCount,
      processed: snapshot.processedCount,
      succeeded: documents.length,
      failed: failures.length,
      limitReached,
      ...(failures.length ? { failures } : {})
    },
    null
  )
  return true
}

function resolvedDiscovery(discovery: UrlReviewRun['discovery']): 'llms' | 'openapi' | 'pages' {
  return discovery === 'llms' || discovery === 'openapi' ? discovery : 'pages'
}
