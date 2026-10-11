import { lookup } from 'node:dns/promises'
import { isAllowedNavigation, PooledBrowserCrawler } from '@loci/core'
import type { RenderedCrawler } from '@loci/core'
import type { BrowserConfig } from './browser-config.js'
import { assertPublicUrl, type DnsLookup } from './public-fetch.js'

/** 每次同步复用 Crawlee 浏览器池；所有子资源仍通过 Server 公网校验。 */
export function createBrowserCrawler(
  config: BrowserConfig,
  lookupImpl: DnsLookup = lookup
): RenderedCrawler {
  const withBrowser = async <T>(
    action: (crawler: PooledBrowserCrawler) => Promise<T>
  ): Promise<T> => {
    const crawler = new PooledBrowserCrawler({
      endpoint: config.provider === 'local' ? undefined : config.endpoint,
      guardRequest: (url, navigation, request) =>
        assertAllowedBrowserRequest(
          url,
          request.hostname,
          navigation,
          lookupImpl,
          request.scopePath
        )
    })
    try {
      return await action(crawler)
    } finally {
      await crawler.close()
    }
  }
  return {
    fetchPage: (url, request) => withBrowser((crawler) => crawler.fetchPage(url, request)),
    withSession: withBrowser
  }
}

export async function assertAllowedBrowserRequest(
  input: string,
  hostname: string | undefined,
  navigation: boolean,
  lookupImpl: DnsLookup = lookup,
  scopePath = '/'
): Promise<void> {
  const url = new URL(input)
  if (!navigation && (url.protocol === 'data:' || url.protocol === 'blob:')) return
  await assertPublicUrl(url, lookupImpl)
  if (navigation && hostname && !isAllowedNavigation(url.toString(), hostname, scopePath)) {
    throw new Error('页面导航超出了文档库范围')
  }
}
