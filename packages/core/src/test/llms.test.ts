import { describe, expect, it } from 'vitest'
import { fetchMarkdownPage } from '../llms.js'

describe('fetchMarkdownPage', () => {
  it('使用 Markdown 首标题替换 llms.txt 的 Untitled 占位名', async () => {
    const markdown = [
      '---',
      'url: /api-proxy/base/app/app-event/onError.md',
      '---',
      '',
      '## mpx.onError(function listener)',
      '',
      '监听小程序错误事件。'
    ].join('\n')

    const result = await fetchMarkdownPage(
      {
        title: 'Untitled',
        url: 'https://mpxjs.cn/api-proxy/base/app/app-event/onError.md'
      },
      { fetchImpl: async () => new Response(markdown) }
    )

    expect(result.page?.title).toBe('mpx.onError(function listener)')
    expect(result.page?.markdown).toBe(markdown)
  })

  it('保留 llms.txt 中有意义的条目名称', async () => {
    const result = await fetchMarkdownPage(
      { title: '快速开始', url: 'https://docs.example.com/start.md' },
      { fetchImpl: async () => new Response('# Installation') }
    )

    expect(result.page?.title).toBe('快速开始')
  })

  it('占位名且正文无标题时回退到 URL 文件名', async () => {
    const result = await fetchMarkdownPage(
      { title: 'Untitled', url: 'https://docs.example.com/reference/client-api.md' },
      { fetchImpl: async () => new Response('只有正文。') }
    )

    expect(result.page?.title).toBe('client-api')
  })
})
