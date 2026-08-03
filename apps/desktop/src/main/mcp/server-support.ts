import type { ServerContext } from '@modelcontextprotocol/server'
import type { CrawlProgress, CrawlRunState, DocumentSource, SourceStatus } from '@loci/shared'
import type { LociMcpServices } from './server'

export async function waitForSync(
  services: LociMcpServices,
  libraryId: string,
  context: ServerContext
): Promise<Record<string, unknown>> {
  try {
    const progress = await services.crawlSource(libraryId, progressReporter(context, libraryId))
    return {
      library_id: libraryId,
      status: progress.failed ? 'completed_with_errors' : 'completed',
      file_count: services.listDocuments().filter((item) => item.sourceId === libraryId).length,
      progress: serializeProgress(progress)
    }
  } catch (error) {
    const state = services.getCrawlState(libraryId)
    return {
      library_id: libraryId,
      status: 'failed',
      ...(state ? { progress: serializeProgress(state.progress) } : {}),
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
}

export function startInBackground(services: LociMcpServices, libraryId: string): void {
  void services.crawlSource(libraryId).catch(() => undefined)
}

export function stateToSyncItem(
  libraryId: string,
  state: CrawlRunState | undefined,
  crawling: boolean
): Record<string, unknown> {
  if (!state) return { library_id: libraryId, status: crawling ? 'syncing' : 'idle' }
  return {
    library_id: libraryId,
    status:
      crawling || state.running
        ? 'syncing'
        : state.error
          ? 'failed'
          : state.progress.failed
            ? 'completed_with_errors'
            : 'completed',
    progress: serializeProgress(state.progress),
    ...(state.error ? { error: state.error } : {})
  }
}

function progressReporter(
  context: ServerContext,
  libraryId: string
): (progress: CrawlProgress) => void {
  const progressToken = context.mcpReq._meta?.progressToken
  let lastProcessed = -1
  return (progress) => {
    if (progressToken === undefined || progress.processed === lastProcessed) return
    lastProcessed = progress.processed
    void context.mcpReq
      .notify({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: progress.processed,
          total: Math.max(progress.queued, progress.processed),
          message: `${libraryId}: ${progress.succeeded} succeeded, ${progress.failed} failed`
        }
      })
      .catch(() => undefined)
  }
}

export function serializeLibrary(
  source: DocumentSource,
  status?: SourceStatus
): Record<string, unknown> {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    mode: source.mode,
    status: status ?? source.status,
    pages: source.pages,
    page_limit: source.pageLimit,
    last_updated: source.lastUpdated,
    schedule: source.schedule,
    http_concurrency: source.httpConcurrency,
    browser_concurrency: source.browserConcurrency,
    icon_url: source.iconUrl
  }
}

function serializeProgress(progress: CrawlProgress): Record<string, unknown> {
  return {
    queued: progress.queued,
    processed: progress.processed,
    succeeded: progress.succeeded,
    failed: progress.failed,
    limit_reached: progress.limitReached,
    ...(progress.failures?.length
      ? {
          failures: progress.failures.map((failure) => ({
            url: failure.url,
            reason: failure.reason,
            message: failure.message,
            retryable: failure.retryable,
            ...(failure.statusCode === undefined ? {} : { status_code: failure.statusCode }),
            ...(failure.redirectUrl ? { redirect_url: failure.redirectUrl } : {})
          }))
        }
      : {})
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
  body = JSON.stringify(output, null, 2)
): { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> } {
  return { content: [{ type: 'text', text: `${summary}\n\n${body}` }], structuredContent: output }
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
  return `${String(item.library_id)}: ${String(item.status)}`
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
