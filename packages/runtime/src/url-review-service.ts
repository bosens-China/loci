import {
  discoverLlmsEntries,
  discoverOpenApiEntries,
  discoverSitemapUrls,
  fetchCrawledPageWithRetry,
  fetchHttpPage,
  fetchMarkdownPage,
  probeSourcePage,
  renderOpenApiMarkdown,
  type CrawledPage
} from '@loci/core'
import type { LociDatabase, SourceConfig } from './database.js'
import type { BrowserInstallPrompt, LocalBrowserCrawler } from './browser-crawler.js'
import type {
  UrlReviewCandidate,
  UrlReviewCandidateInput,
  UrlReviewRun,
  UrlReviewSnapshot
} from './url-review-database.js'
import {
  normalizeReviewLinks,
  providedReviewCandidate,
  reviewPageOutcome,
  titleFromUrl
} from './url-review-page.js'
import { commitUrlReview } from './url-review-commit.js'
import { rethrowRequestCancellation } from './url-review-cancellation.js'
import { acquireUrlReviewRuntimeLock } from './url-review-lock.js'

const REVIEW_BATCH_SIZE = 50

export interface UrlReviewService {
  start: (
    sourceId: string,
    goal?: string,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal
  ) => Promise<UrlReviewSnapshot>
  submit: (
    runId: string,
    batchId: string,
    excludeUrls: readonly string[],
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal
  ) => Promise<UrlReviewSnapshot>
  get: (runId: string) => UrlReviewSnapshot | undefined
  getActive: (sourceId: string) => UrlReviewSnapshot | undefined
  cancel: (runId: string) => boolean
}

interface UrlReviewServiceOptions {
  database: LociDatabase
  browser: LocalBrowserCrawler
  dataDir: string
  owner: string
}

/** URL 审查按批次推进；等待 Agent 时不占用抓取锁或后台 worker。 */
export function createUrlReviewService(options: UrlReviewServiceOptions): UrlReviewService {
  const { database } = options
  const advances = new Map<string, Promise<UrlReviewSnapshot>>()
  const advanceOnce = async (
    runId: string,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal
  ): Promise<UrlReviewSnapshot> => {
    const initial = requireRun(database, runId)
    if (initial.status === 'awaiting_review' || isFinished(initial)) {
      return requireSnapshot(database, runId)
    }
    const lock = await acquireUrlReviewRuntimeLock({
      dataDir: options.dataDir,
      sourceId: initial.sourceId,
      owner: options.owner,
      signal,
      shouldContinue: () => requireRun(database, runId).status === 'discovering'
    })
    if (!lock) return requireSnapshot(database, runId)
    try {
      let run = requireRun(database, runId)
      const source = database.getSourceConfig(run.sourceId)
      assertReviewable(source)
      if (run.discovery === 'new') await discoverInitial(database, run, source, signal)
      run = requireRun(database, runId)
      if (run.status !== 'discovering') return requireSnapshot(database, runId)

      while (true) {
        signal?.throwIfAborted()
        run = requireRun(database, runId)
        if (run.status !== 'discovering') return requireSnapshot(database, runId)
        const approved = database.listApprovedUrlReviewCandidates(runId)
        if (approved.length) {
          await processApproved(options, run, source, approved, onBrowserMissing, signal)
          run = requireRun(database, runId)
          if (isFinished(run)) return requireSnapshot(database, runId)
          continue
        }

        const before = requireSnapshot(database, runId)
        const remaining = Math.max(0, source.pageLimit - before.processedCount)
        const next = database.assignUrlReviewBatch(runId, Math.min(REVIEW_BATCH_SIZE, remaining))
        if (next.run.status !== 'discovering' || next.batchId) return next
        const pending = next.discoveredCount - next.approvedCount - next.excludedCount
        const limitReached = remaining === 0 && pending > 0
        commitUrlReview(database, run, source, limitReached)
        return requireSnapshot(database, runId)
      }
    } catch (error) {
      rethrowRequestCancellation(error, signal)
      if (isFinished(requireRun(database, runId))) return requireSnapshot(database, runId)
      database.failUrlReview(runId, error instanceof Error ? error.message : 'URL 审查失败')
      if (requireRun(database, runId).status === 'cancelled') {
        return requireSnapshot(database, runId)
      }
      throw error
    } finally {
      lock.release()
    }
  }
  const advance = (
    runId: string,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal
  ): Promise<UrlReviewSnapshot> => {
    const current = advances.get(runId)
    if (current) return current
    const task = advanceOnce(runId, onBrowserMissing, signal).finally(() => advances.delete(runId))
    advances.set(runId, task)
    return task
  }

  return {
    start: async (sourceId, goal, onBrowserMissing, signal) => {
      const source = database.getSourceConfig(sourceId)
      assertReviewable(source)
      const run = database.startUrlReview(
        sourceId,
        goal?.trim() || source.reviewGoal || '',
        source.firstUrl
      )
      return advance(run.id, onBrowserMissing, signal)
    },
    submit: async (runId, batchId, excludeUrls, onBrowserMissing, signal) => {
      database.submitUrlReviewBatch(runId, batchId, [...new Set(excludeUrls)])
      const run = requireRun(database, runId)
      return isFinished(run)
        ? requireSnapshot(database, runId)
        : advance(runId, onBrowserMissing, signal)
    },
    get: (runId) => database.getUrlReviewSnapshot(runId),
    getActive: (sourceId) => {
      const run = database.getActiveUrlReview(sourceId)
      return run ? database.getUrlReviewSnapshot(run.id) : undefined
    },
    cancel: (runId) => database.cancelUrlReview(runId)
  }
}

async function discoverInitial(
  database: LociDatabase,
  run: UrlReviewRun,
  source: SourceConfig,
  signal?: AbortSignal
): Promise<void> {
  const settings = database.getSettings()
  const stored: UrlReviewCandidateInput[] = database
    .listDocumentCandidates(source.id)
    .map((item) => ({ ...item, titleSource: 'stored' }))
  database.addUrlReviewCandidates(run.id, stored)

  const llms = await discoverLlmsEntries(
    source.firstUrl,
    source.hostname,
    source.scopePath,
    source.pageLimit,
    { signal }
  )
  if (!isDiscovering(database, run.id)) return
  if (llms.length) {
    database.addUrlReviewCandidates(
      run.id,
      llms.map((item) => ({ ...item, titleSource: 'llms' }))
    )
    database.updateUrlReviewDiscovery(run.id, 'llms', 'http', source.firstUrl, null)
    return
  }

  const openapi = await discoverOpenApiEntries(source.firstUrl, source.hostname, { signal })
  if (!isDiscovering(database, run.id)) return
  if (openapi.length) {
    database.addUrlReviewCandidates(
      run.id,
      openapi.map((item) => ({
        url: item.url,
        title: item.title,
        titleSource: 'openapi',
        document: {
          url: item.url,
          title: item.title,
          language: 'und',
          markdown: renderOpenApiMarkdown(item.document),
          crawledAt: new Date().toISOString(),
          fetchMode: 'http'
        }
      }))
    )
    database.updateUrlReviewDiscovery(run.id, 'openapi', 'http', source.firstUrl, null)
    return
  }

  const sitemap = await discoverSitemapUrls(
    source.firstUrl,
    source.hostname,
    source.pageLimit,
    { maxRetries: settings.maxRetries, signal },
    source.scopePath
  )
  if (!isDiscovering(database, run.id)) return
  if (sitemap.length) {
    database.addUrlReviewCandidates(run.id, [
      ...(stored.length
        ? []
        : [{ ...providedReviewCandidate(source.firstUrl), decision: 'approved' as const }]),
      ...sitemap.map((url) => ({ url, title: titleFromUrl(url), titleSource: 'pathname' as const }))
    ])
    database.updateUrlReviewDiscovery(run.id, 'sitemap', source.fetchMode, source.firstUrl, null)
    return
  }

  if (!stored.length) {
    database.addUrlReviewCandidates(run.id, [
      { ...providedReviewCandidate(source.firstUrl), decision: 'approved' }
    ])
  } else if (!stored.some((item) => item.url === source.firstUrl)) {
    database.addUrlReviewCandidates(run.id, [providedReviewCandidate(source.firstUrl)])
  }
  database.updateUrlReviewDiscovery(run.id, 'pages', source.fetchMode, source.firstUrl, null)
}

async function processApproved(
  options: UrlReviewServiceOptions,
  run: UrlReviewRun,
  source: SourceConfig,
  approved: readonly UrlReviewCandidate[],
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal
): Promise<void> {
  let fetchMode = run.fetchMode
  let seed: { url: string; page: CrawledPage } | undefined
  if (fetchMode === 'auto' && run.discovery !== 'openapi' && run.discovery !== 'llms') {
    const first = approved[0]
    if (first) {
      const selected = await probeSourcePage({
        firstUrl: first.url,
        hostname: source.hostname,
        scopePath: source.scopePath,
        pageLimit: 1,
        fetchMode: source.fetchMode,
        signal,
        crawler: { fetchPage: (url, request) => options.browser.fetchPage(url, request) },
        beforeBrowserCrawl: () => options.browser.ensureInstalled(onBrowserMissing),
        onDocument: () => undefined
      })
      if (!isDiscovering(options.database, run.id)) return
      fetchMode = selected.fetchMode
      seed = { url: first.url, page: selected.firstPage }
      options.database.updateUrlReviewDiscovery(
        run.id,
        run.discovery === 'new' ? 'pages' : run.discovery,
        fetchMode,
        selected.firstPage.url,
        selected.firstPage.page?.iconUrl ?? null
      )
    }
  }
  if (fetchMode === 'browser') {
    await options.browser.ensureInstalled(onBrowserMissing)
    if (!isDiscovering(options.database, run.id)) return
  }
  const settings = options.database.getSettings()
  const concurrency =
    fetchMode === 'browser'
      ? (source.browserConcurrency ?? settings.browserConcurrency)
      : (source.httpConcurrency ?? settings.httpConcurrency)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < approved.length) {
      if (!isDiscovering(options.database, run.id)) return
      const candidate = approved[cursor++]
      if (!candidate) continue
      signal?.throwIfAborted()
      if (candidate.document) {
        options.database.completeUrlReviewCandidate(candidate.id, candidate.document, undefined, [])
        continue
      }
      try {
        const page =
          seed?.url === candidate.url
            ? seed.page
            : await fetchReviewPage(
                options,
                run,
                source,
                candidate,
                fetchMode,
                settings.maxRetries,
                signal
              )
        if (!isDiscovering(options.database, run.id)) return
        if (seed?.url === candidate.url) seed = undefined
        const outcome = reviewPageOutcome(candidate.url, page, source, fetchMode)
        const links =
          !outcome.failure && run.discovery === 'pages'
            ? normalizeReviewLinks(
                page.page?.linkCandidates,
                page.page?.links ?? [],
                page.url,
                source
              )
            : []
        options.database.completeUrlReviewCandidate(
          candidate.id,
          outcome.document,
          outcome.failure,
          links
        )
      } catch (error) {
        rethrowRequestCancellation(error, signal)
        if (!isDiscovering(options.database, run.id)) return
        options.database.completeUrlReviewCandidate(
          candidate.id,
          undefined,
          {
            url: candidate.url,
            reason: 'request_error',
            message: error instanceof Error ? error.message : '页面请求失败',
            retryable: true
          },
          []
        )
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, approved.length) }, () => worker()))
}

async function fetchReviewPage(
  options: UrlReviewServiceOptions,
  run: UrlReviewRun,
  source: SourceConfig,
  candidate: UrlReviewCandidate,
  fetchMode: UrlReviewRun['fetchMode'],
  maxRetries: number,
  signal?: AbortSignal
): Promise<CrawledPage> {
  if (run.discovery === 'llms') {
    return fetchMarkdownPage({ title: candidate.title, url: candidate.url }, { signal })
  }
  if (fetchMode === 'browser') {
    return fetchCrawledPageWithRetry(
      { fetchPage: (url, request) => options.browser.fetchPage(url, request) },
      candidate.url,
      { hostname: source.hostname, scopePath: source.scopePath, signal },
      { maxRetries, signal }
    )
  }
  return fetchHttpPage(candidate.url, { maxRetries, signal })
}

function assertReviewable(source: SourceConfig): void {
  if (source.discoveryMode !== 'agent_review') throw new Error('该文档库未启用 Agent URL 审查模式')
  if (source.kind !== 'web') throw new Error('Agent URL 审查模式暂不支持 GitHub 仓库')
  if (!source.reviewGoal) throw new Error('Agent URL 审查模式缺少收录目标')
}

function requireRun(database: LociDatabase, runId: string): UrlReviewRun {
  const run = database.getUrlReview(runId)
  if (!run) throw new Error('URL 审查运行不存在')
  return run
}

function requireSnapshot(database: LociDatabase, runId: string): UrlReviewSnapshot {
  const snapshot = database.getUrlReviewSnapshot(runId)
  if (!snapshot) throw new Error('URL 审查运行不存在')
  return snapshot
}

function isFinished(run: UrlReviewRun): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
}

function isDiscovering(database: LociDatabase, runId: string): boolean {
  return requireRun(database, runId).status === 'discovering'
}
