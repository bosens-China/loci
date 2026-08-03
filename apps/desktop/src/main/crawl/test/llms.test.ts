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
        fetchImpl,
        sleep: async () => undefined
      })
    ).resolves.toEqual([{ title: 'Guide', url: 'https://docs.example.com/guide/index.md' }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://docs.example.com/llms.txt')
  })

  it('直接保存 Markdown，不执行 HTML 转换', async () => {
    const body = '\uFEFF# Guide\r\n\r\n```tsx\r\n<Button />\r\n```\r\n'
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/markdown' } })
    )
    const page = await fetchMarkdownPage(
      { title: 'Guide', url: 'https://docs.example.com/guide.md' },
      { fetchImpl, sleep: async () => undefined }
    )
    expect(page.page).toEqual({
      title: 'Guide',
      language: 'und',
      markdown: '# Guide\n\n```tsx\n<Button />\n```',
      links: []
    })
  })

  it('把清单作为权威页面集合', async () => {
    const documents: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(
      async (input) =>
        new Response(`# ${String(input)}`, {
          status: 200,
          headers: { 'content-type': 'text/markdown' }
        })
    )
    const progress = await crawlLlmsSource(
      {
        firstUrl: 'https://docs.example.com/start',
        hostname: 'docs.example.com',
        scopePath: '/guide',
        pageLimit: 2,
        concurrency: 1,
        fetch: fetchImpl,
        sleep: async () => undefined,
        onDocument: (document) => {
          documents.push(document.url)
        }
      },
      [
        { title: 'One', url: 'https://docs.example.com/guide/one.md' },
        { title: 'Two', url: 'https://docs.example.com/guide/two.md' }
      ]
    )
    expect(documents).toEqual([
      'https://docs.example.com/guide/one.md',
      'https://docs.example.com/guide/two.md'
    ])
    expect(progress).toMatchObject({ queued: 2, succeeded: 2, failed: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
