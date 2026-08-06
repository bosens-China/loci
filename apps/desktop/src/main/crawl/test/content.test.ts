import { describe, expect, it } from 'vitest'
import { parsePage } from '@loci/core'

describe('parsePage', () => {
  it('extracts page metadata, readable markdown, and normalized links', () => {
    const page = parsePage(
      '<html lang="zh-CN"><head><title>开始使用</title><link rel="shortcut icon" href="/logo.svg"></head><body><nav>菜单</nav><main><h1>开始使用</h1><p><strong>你好</strong>，文档。</p><a href="/next?from=home#top">下一页</a></main><script>ignored()</script></body></html>',
      'https://docs.example.com/start'
    )

    expect(page.title).toBe('开始使用')
    expect(page.language).toBe('zh-CN')
    expect(page.markdown).toContain('**你好**')
    expect(page.markdown).not.toContain('菜单')
    expect(page.links).toEqual(['https://docs.example.com/next'])
    expect(page.iconUrl).toBe('https://docs.example.com/logo.svg')
  })
})
