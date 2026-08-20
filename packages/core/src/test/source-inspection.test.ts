import { describe, expect, it, vi } from 'vitest'
import { inspectSource } from '../source-inspection.js'

describe('inspectSource', () => {
  it('根据 llms.txt 统计范围和可选排除后的页面数量', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === 'https://example.com/llms.txt') {
        return new Response(
          '- [English](/docs/en/start.md)\n- [中文](/docs/zh/start.md)\n- [API](/docs/en/api.md)',
          { status: 200, headers: { 'content-type': 'text/plain' } }
        )
      }
      return new Response('', { status: 404 })
    })

    const result = await inspectSource({
      url: 'https://example.com/docs/start',
      scopePath: '/docs',
      excludePathPattern: '^/docs/zh(?:/|$)',
      fetch: fetchImpl
    })

    expect(result).toMatchObject({
      discovery: 'llms',
      estimateKind: 'exact',
      discoveredPages: 3,
      excludedPages: 1,
      estimatedPages: 2,
      pathGroups: [
        { path: '/docs/en', pages: 2 },
        { path: '/docs/zh', pages: 1 }
      ]
    })
  })

  it('没有轻量清单时返回 unknown，不递归读取普通页面', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 404 }))

    const result = await inspectSource({
      url: 'https://example.com/guide/start',
      fetch: fetchImpl
    })

    expect(result).toMatchObject({
      discovery: 'unknown',
      estimateKind: 'unknown',
      estimatedPages: null
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/llms.txt',
      expect.objectContaining({ redirect: 'follow' })
    )
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/sitemap.xml', expect.any(Object))
    expect(fetchImpl).not.toHaveBeenCalledWith('https://example.com/guide/start', expect.anything())
  })

  it('估算不被产品默认的 1000 页截断', async () => {
    const manifest = Array.from(
      { length: 1500 },
      (_, index) => `- [Page ${String(index)}](/docs/page-${String(index)}.md)`
    ).join('\n')
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input) === 'https://example.com/llms.txt'
        ? new Response(manifest, { status: 200 })
        : new Response('', { status: 404 })
    )

    const result = await inspectSource({
      url: 'https://example.com/docs/start',
      scopePath: '/docs',
      fetch: fetchImpl
    })

    expect(result).toMatchObject({
      discovery: 'llms',
      estimateKind: 'exact',
      estimatedPages: 1500,
      exceedsHardLimit: false,
      hardPageLimit: 10_000
    })
  })

  it('GitHub 只读取仓库和默认分支元数据', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/repos/openai/example')) {
        return Response.json({ private: false, default_branch: 'main' })
      }
      if (url.endsWith('/branches/main')) return Response.json({ commit: { sha: 'abc123' } })
      return new Response('', { status: 404 })
    })

    const result = await inspectSource({
      url: 'https://github.com/openai/example/tree/main/docs',
      fetch: fetchImpl
    })

    expect(result).toMatchObject({
      url: 'https://github.com/openai/example',
      kind: 'github',
      discovery: 'github',
      estimateKind: 'unknown',
      githubDefaultBranch: 'main',
      githubRevision: 'abc123'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
