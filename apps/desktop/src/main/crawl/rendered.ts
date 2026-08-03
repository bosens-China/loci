import type { CrawledPage, RenderedPageRequest } from '@loci/core'
import { fetchRenderedPage } from './browser'
import { parsePage } from './content'
import { normalizeUrl } from './url'

/** Electron 适配器只负责把浏览器结果转换为核心包的统一页面格式。 */
export async function fetchRenderedCrawlPage(
  url: string,
  request: RenderedPageRequest = {}
): Promise<CrawledPage> {
  const response = await fetchRenderedPage(url, request)
  const finalUrl = normalizeUrl(response.url || url)
  return {
    url: finalUrl,
    status: response.status,
    retryAfter: response.retryAfter,
    ...(response.status >= 200 && response.status < 300
      ? { page: parsePage(response.html, finalUrl) }
      : {})
  }
}
