import { crawlSource, GithubLimitError } from '@loci/core'
import type { CrawlProgress } from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'
import { fetchRenderedCrawlPage } from './rendered'

/** 桌面端只连接数据库与 Electron 浏览器，抓取流程统一由核心包编排。 */
export async function runSourceCrawl(
  database: LociDatabase,
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void,
  waitIfPaused?: () => Promise<void>,
  sleep?: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal
): Promise<CrawlProgress> {
  const source = database.getSourceConfig(sourceId)
  const settings = database.getSettings()
  const documents: Parameters<LociDatabase['saveDocument']>[0][] = []
  const deletedUrls: string[] = []
  let replaceAll = false
  try {
    const result = await crawlSource({
      firstUrl: source.firstUrl,
      firstNodeId: source.firstUrl,
      hostname: source.hostname,
      scopePath: source.scopePath,
      excludePathPattern: source.excludePathPattern,
      pageLimit: source.pageLimit,
      initialUrls: database.listDocumentUrls(sourceId),
      fetchMode: source.fetchMode,
      httpConcurrency: source.httpConcurrency ?? settings.httpConcurrency,
      browserConcurrency: source.browserConcurrency ?? settings.browserConcurrency,
      maxRetries: settings.maxRetries,
      batchIntervalMs: settings.batchIntervalSeconds * 1000,
      waitIfPaused,
      sleep,
      signal,
      crawler: { fetchPage: fetchRenderedCrawlPage },
      githubArchiveLimitBytes:
        (source.githubArchiveLimitMb ?? settings.githubArchiveLimitMb) * 1024 * 1024,
      githubMarkdownLimitBytes:
        (source.githubMarkdownLimitMb ?? settings.githubMarkdownLimitMb) * 1024 * 1024,
      githubPreviousRevision: source.githubRevision,
      githubBlocked: source.githubBlocked,
      onDocument: (document) => {
        documents.push({ ...document, sourceId })
      },
      onSnapshot: (snapshot) => {
        replaceAll = true
        documents.push(...snapshot.map((document) => ({ ...document, sourceId })))
      },
      onError: ({ url, missing }) => {
        if (missing) deletedUrls.push(url)
      },
      onDuplicate: ({ url }) => {
        deletedUrls.push(url)
      },
      onProgress
    })
    if (result.progress.succeeded === 0 && result.progress.failed > 0) {
      throw new Error(`抓取失败：${result.progress.failed} 个页面均未成功`)
    }
    signal?.throwIfAborted()
    database.commitSourceCrawl(sourceId, {
      documents,
      deletedUrls,
      replaceAll,
      resolution: {
        firstUrl: result.resolution.firstUrl,
        mode: result.resolution.fetchMode,
        iconUrl: result.resolution.iconUrl,
        github: result.resolution.github
      }
    })
    return result.progress
  } catch (error) {
    if (error instanceof GithubLimitError) {
      database.updateGithubBlocked(sourceId, {
        revision: error.revision,
        kind: error.kind,
        limitBytes: error.limitBytes
      })
    }
    throw error
  }
}
