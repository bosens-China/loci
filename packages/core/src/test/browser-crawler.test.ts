import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { PooledBrowserCrawler } from '../browser-crawler.js'

const executablePath = process.env.LOCI_TEST_BROWSER_EXECUTABLE

describe.skipIf(!executablePath)('真实浏览器池集成', () => {
  it.each(['local', 'remote'])(
    '%s 浏览器隔离 Cookie、等待动态正文并回收资源',
    async (mode) => {
      const cookies: Array<string | undefined> = []
      const server = createServer((request, response) => {
        if (request.url === '/content') {
          response.end('Rendered documentation')
          return
        }
        cookies.push(request.headers.cookie)
        response.setHeader('Content-Type', 'text/html')
        response.setHeader('Set-Cookie', 'session=private')
        response.end(
          '<html lang="en"><title>Docs</title><main>Loading...</main><script>fetch("/content").then(r=>r.text()).then(t=>document.querySelector("main").textContent=t)</script></html>'
        )
      }).listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试服务未启动')
      const base = `http://127.0.0.1:${address.port}`
      const browserServer =
        mode === 'remote'
          ? await chromium.launchServer({ executablePath, headless: true })
          : undefined
      const crawler = new PooledBrowserCrawler({
        executablePath,
        endpoint: browserServer?.wsEndpoint()
      })
      try {
        const pages = await Promise.all(
          ['/one', '/two'].map((path) => crawler.fetchPage(base + path))
        )
        await crawler.fetchPage(base + '/three')
        expect(pages.map((page) => page.page?.markdown)).toEqual([
          'Rendered documentation',
          'Rendered documentation'
        ])
        expect(cookies).toEqual([undefined, undefined, undefined])
      } finally {
        await crawler.close()
        await browserServer?.close()
        server.close()
        await once(server, 'close')
      }
    },
    20_000
  )
})
