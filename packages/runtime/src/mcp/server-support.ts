import type { CrawlFailure, CrawlProgress, CrawlRunState, DocumentSource } from '@loci/shared'
import type { LociMcpServices } from './server.js'
import type { LociToolContext } from './tool-registry.js'

export async function waitForSync(
  services: LociMcpServices,
  libraryId: string,
  context: LociToolContext
): Promise<Record<string, unknown>> {
  const reporter = createProgressReporter(context, libraryId)
  try {
    const progress = await services.crawlSource(libraryId, reporter.report, context.signal)
    await reporter.flush()
    const runId = services.getLatestCrawlRunId(libraryId)
    return {
      library_id: libraryId,
      sync_status: progress.failed ? 'completed_with_errors' : 'completed',
      ...(runId ? { run_id: runId } : {}),
      file_count: services.listDocuments().filter((item) => item.sourceId === libraryId).length,
      progress: serializeProgress(progress)
    }
  } catch (error) {
    await reporter.flush()
    if (context.signal?.aborted) throw context.signal.reason
    const state = services.getCrawlState(libraryId)
    const runId = services.getLatestCrawlRunId(libraryId)
    return {
      library_id: libraryId,
      sync_status: 'failed',
      ...(runId ? { run_id: runId } : {}),
      ...(state ? { progress: serializeProgress(state.progress) } : {}),
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
}

export function startInBackground(
  services: LociMcpServices,
  libraryId: string,
  context?: LociToolContext
): void {
  const task = services
    .crawlSource(libraryId)
    .then(() => undefined)
    .catch(() => undefined)
  context?.trackBackgroundTask?.(task)
}

export function stateToSyncItem(
  libraryId: string,
  state: CrawlRunState | undefined,
  crawling: boolean,
  runId?: string
): Record<string, unknown> {
  if (!state) {
    return {
      library_id: libraryId,
      sync_status: crawling ? 'syncing' : 'idle',
      ...(runId ? { run_id: runId } : {})
    }
  }
  return {
    library_id: libraryId,
    sync_status:
      crawling || state.running
        ? 'syncing'
        : state.error
          ? 'failed'
          : state.progress.failed
            ? 'completed_with_errors'
            : 'completed',
    ...(runId ? { run_id: runId } : {}),
    progress: serializeProgress(state.progress),
    ...(state.error ? { error: state.error } : {})
  }
}

export function createProgressReporter(
  context: LociToolContext,
  libraryId: string
): { report: (progress: CrawlProgress) => void; flush: () => Promise<void> } {
  const progressToken = context.progressToken
  let lastReported = -1
  let lastNode = ''
  let notifications = Promise.resolve()
  const report = (progress: CrawlProgress): void => {
    const node = progress.node
    const completedNode = node && (node.status === 'success' || node.status === 'failed')
    const nodeKey = completedNode ? `${node.id}:${node.status}` : ''
    if (progressToken === undefined || !context.notifyProgress) return
    if (completedNode && nodeKey === lastNode) return
    if (!completedNode && progress.processed <= lastReported) return
    if (completedNode) lastNode = nodeKey
    lastReported = Math.max(lastReported, progress.processed)
    const reported = lastReported
    const total = Math.max(progress.queued, progress.processed, reported)
    const message = completedNode
      ? `${libraryId}: [${reported}/${total}] ${node.status} ${node.title} ${node.url}`
      : `${libraryId}: ${progress.succeeded} succeeded, ${progress.failed} failed`
    notifications = notifications
      .then(() => context.notifyProgress?.(reported, total, message))
      .then(() => undefined)
      .catch(() => undefined)
  }
  return { report, flush: () => notifications }
}

export function serializeLibrary(source: DocumentSource): Record<string, unknown> {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    mode: source.mode,
    availability: source.pages > 0 ? 'usable' : 'empty',
    pages: source.pages,
    content_size: source.contentSize,
    page_limit: source.pageLimit,
    scope_path: source.scopePath,
    exclude_path: source.excludePathPattern ?? null,
    last_updated: source.lastUpdated,
    schedule: source.schedule,
    http_concurrency: source.httpConcurrency,
    browser_concurrency: source.browserConcurrency,
    kind: source.kind,
    github_archive_limit_mb: source.githubArchiveLimitMb,
    github_markdown_limit_mb: source.githubMarkdownLimitMb,
    icon_url: source.iconUrl,
    discovery_mode: source.discoveryMode,
    resolved_discovery: source.resolvedDiscovery,
    review_goal: source.reviewGoal
  }
}

export function serializeProgress(progress: CrawlProgress): Record<string, unknown> {
  const failures = progress.failures ?? []
  const sample = failures.slice(0, 5)
  return {
    queued: progress.queued,
    processed: progress.processed,
    succeeded: progress.succeeded,
    failed: progress.failed,
    limit_reached: progress.limitReached,
    failures_total: progress.failed,
    failure_counts: failures.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1
      return counts
    }, {}),
    ...(sample.length ? { failures_sample: sample.map(serializeFailure) } : {}),
    has_more_failures: progress.failed > sample.length
  }
}

export function serializeFailure(item: CrawlFailure): Record<string, unknown> {
  return {
    url: item.url,
    reason: item.reason,
    message: item.message,
    retryable: item.retryable,
    ...(item.statusCode === undefined ? {} : { status_code: item.statusCode }),
    ...(item.redirectUrl ? { redirect_url: item.redirectUrl } : {})
  }
}

export function page<T>(
  items: T[],
  total: number,
  offset: number,
  limit: number
): Record<string, unknown> {
  const hasMore = offset + items.length < total
  return {
    total_count: total,
    count: items.length,
    offset,
    items,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + limit } : {})
  }
}

export function result(
  output: Record<string, unknown>,
  summary: string,
  body?: string
): { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> } {
  return {
    content: [{ type: 'text', text: body ? `${summary}\n\n${body}` : summary }],
    structuredContent: output
  }
}

export function failure(message: string): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function renderFiles(
  files: Array<{ title: string; source_url: string; content: string }>
): string {
  return files
    .map((file) => `# ${file.title}\nSource: ${file.source_url}\n\n${file.content}`)
    .join('\n\n---\n\n')
}

export function syncSummary(item: Record<string, unknown>): string {
  return `${String(item.library_id)}: ${String(item.sync_status)}`
}

export function readAnnotations(): {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
} {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

export function remoteReadAnnotations(): {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
} {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
}

export function writeAnnotations(idempotent: boolean): {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
} {
  return {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: true
  }
}
