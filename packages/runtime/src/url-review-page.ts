import {
  createPathExclusionMatcher,
  isUrlInScope,
  normalizeUrl,
  type CrawledDocument,
  type CrawledPage,
  type CrawlFailure,
  type PageLinkCandidate
} from '@loci/core'
import { deriveUrlPathTitle } from '@loci/shared'
export { deriveUrlPathTitle as titleFromUrl } from '@loci/shared'
import type { SourceConfig } from './database.js'
import type { UrlReviewCandidateInput, UrlReviewRun } from './url-review-types.js'

export function reviewPageOutcome(
  requestedUrl: string,
  result: CrawledPage,
  source: SourceConfig,
  fetchMode: UrlReviewRun['fetchMode']
): { document?: CrawledDocument; failure?: CrawlFailure } {
  const url = normalizeUrl(result.url)
  const excluded = createPathExclusionMatcher(source.excludePathPattern)
  if (!isUrlInScope(url, source.hostname, source.scopePath) || excluded?.(url)) {
    return {
      failure: {
        url: requestedUrl,
        reason: 'out_of_scope_redirect',
        message: '页面跳转到了文档库范围之外或排除路径',
        retryable: false,
        redirectUrl: url
      }
    }
  }
  if (result.status === 404 || result.status === 410) {
    return {
      failure: {
        url: requestedUrl,
        reason: 'not_found',
        message: `页面返回 HTTP ${result.status}`,
        retryable: false,
        statusCode: result.status
      }
    }
  }
  if (result.status < 200 || result.status >= 300 || !result.page) {
    return {
      failure: {
        url: requestedUrl,
        reason: 'http_error',
        message: result.status ? `页面返回 HTTP ${result.status}` : '页面未返回可解析内容',
        retryable:
          result.status === 0 ||
          result.status === 408 ||
          result.status === 429 ||
          result.status >= 500,
        ...(result.status ? { statusCode: result.status } : {})
      }
    }
  }
  return {
    document: {
      url,
      title: result.page.title,
      language: result.page.language,
      markdown: result.page.markdown,
      crawledAt: new Date().toISOString(),
      fetchMode: fetchMode === 'browser' ? 'browser' : 'http'
    }
  }
}

export function normalizeReviewLinks(
  candidates: readonly PageLinkCandidate[] | undefined,
  links: readonly string[],
  discoveredFrom: string,
  source: SourceConfig
): UrlReviewCandidateInput[] {
  const excluded = createPathExclusionMatcher(source.excludePathPattern)
  const inputs =
    candidates ??
    links.map((url) => ({
      url,
      title: deriveUrlPathTitle(url),
      titleSource: 'pathname' as const
    }))
  return inputs.flatMap((candidate) => {
    try {
      const url = normalizeUrl(candidate.url)
      if (!isUrlInScope(url, source.hostname, source.scopePath) || excluded?.(url)) return []
      return [{ ...candidate, url, discoveredFrom }]
    } catch {
      return []
    }
  })
}

export function providedReviewCandidate(url: string): UrlReviewCandidateInput {
  return { url, title: deriveUrlPathTitle(url), titleSource: 'provided' }
}
