import { describe, expect, it, vi } from 'vitest'
import { crawlLlmsSource, discoverLlmsEntries, fetchMarkdownPage, parseLlmsTxt } from '../llms'

describe('llms.txt', () => {
  it('按 AST 提取列表链接并应用同域路径范围', () => {
    const content = `# Docs

[说明链接](https://docs.example.com/ignored.md)

## Guide

- [Introduction](https://docs.example.com/guide/introduction.md): intro
- [Nested **title**](/guide/nested.md?from=list#top)
- [API](/api/index.md)
- [Other](https://other.example.com/guide/no.md)
`
    expect(
      parseLlmsTxt(content, 'https://docs.example.com/llms.txt', 'docs.example.com', '/guide')
    ).toEqual([
      { title: 'Introduction', url: 'https://docs.example.com/guide/introduction.md' },
      { title: 'Nested title', url: 'https://docs.example.com/guide/nested.md' }
    ])
  })

  it('从站点根目录发现清单', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('- [Guide](/guide/index.md)', { status: 200 })
    )
    await expect(
      discoverLlmsEntries('https://docs.example.com/guide/start', 'docs.example.com', '/', 10, {
        fetchImpl
      })
    ).resolves.toEqual([{ title: 'Guide', url: 'https://docs.example.com/guide/index.md' }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://docs.example.com/llms.txt')
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual({ redirect: 'follow' })
  })

  it('直接保存 Markdown，不执行 HTML 转换', async () => {
    const body = '\uFEFF# Guide\r\n\r\n```tsx\r\n<Button />\r\n```\r\n'
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/markdown' } })
    )
    const page = await fetchMarkdownPage(
      { title: 'Guide', url: 'https://docs.example.com/guide.md' },
      { fetchImpl }
    )
    expect(page.page).toEqual({
      title: 'Guide',
      language: 'und',
      markdown: '# Guide\n\n```tsx\n<Button />\n```',
      links: []
    })
  })

  it('忽略通用限速配置，一次性请求清单内的全部页面', async () => {
    const documents: string[] = []
    const pending = new Map<string, (response: Response) => void>()
    const fetchImpl = vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve) => {
          pending.set(String(input), resolve)
        })
    )
    const sleep = vi.fn(async () => undefined)
    const waitIfPaused = vi.fn(async () => undefined)
    const crawlPromise = crawlLlmsSource(
      {
        firstUrl: 'https://docs.example.com/start',
        hostname: 'docs.example.com',
        scopePath: '/guide',
        pageLimit: 2,
        concurrency: 1,
        batchIntervalMs: 100_000,
        fetch: fetchImpl,
        sleep,
        waitIfPaused,
        onDocument: (document) => {
          documents.push(document.url)
        }
      },
      [
        { title: 'One', url: 'https://docs.example.com/guide/one.md' },
        { title: 'Two', url: 'https://docs.example.com/guide/two.md' }
      ]
    )

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    for (const [url, resolve] of pending) {
      resolve(
        new Response(`# ${url}`, {
          status: 200,
          headers: { 'content-type': 'text/markdown' }
        })
      )
    }
    const progress = await crawlPromise

    expect(documents).toEqual([
      'https://docs.example.com/guide/one.md',
      'https://docs.example.com/guide/two.md'
    ])
    expect(progress).toMatchObject({ queued: 2, succeeded: 2, failed: 0 })
    expect(fetchImpl.mock.calls.map((call) => call[1])).toEqual([
      { redirect: 'follow' },
      { redirect: 'follow' }
    ])
    expect(sleep).not.toHaveBeenCalled()
    expect(waitIfPaused).not.toHaveBeenCalled()
  })
})
