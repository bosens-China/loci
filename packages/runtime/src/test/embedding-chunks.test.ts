import { describe, expect, it } from 'vitest'
import { splitEmbeddingMarkdown } from '../embedding-chunks.js'

const doc = (markdown: string) => ({ id: 'example', title: '文章', markdown })

describe('Markdown 向量索引片段', () => {
  it('模型放得下时保留整篇原始 Markdown 和小节关联', () => {
    const markdown = '# 安装\n\n介绍\n\n## Windows\n\n运行安装程序'
    const pieces = [...splitEmbeddingMarkdown(doc(markdown), 512, (text) => text.length + 2)]
    expect(pieces).toEqual([
      {
        text: markdown,
        location: {
          startOffset: 0,
          endOffset: markdown.length,
          sectionIds: ['example:section:0', 'example:section:1'],
          headingPath: ['安装']
        }
      }
    ])
  })

  it('长文优先按二级、三级标题切，再按自然边界保证原文覆盖', () => {
    const windows = '## Windows\n\n' + '安装程序。'.repeat(16)
    const mac = '### macOS\n\n使用终端。\n\n' + '执行命令。'.repeat(15)
    const linux = '## Linux\n\n' + '更新依赖。'.repeat(8)
    const markdown = '# 安装\n\n' + windows + '\n\n' + mac + '\n\n' + linux
    const limit = 70
    const count = (text: string) => text.length + 2
    const pieces = [...splitEmbeddingMarkdown(doc(markdown), limit, count)]
    expect(
      pieces
        .map(({ location }) => markdown.slice(location.startOffset, location.endOffset))
        .join('')
    ).toBe(markdown)
    expect(pieces.every(({ text }) => count(text) <= limit)).toBe(true)
    expect(
      pieces
        .filter(
          ({ location }) =>
            location.startOffset >= markdown.indexOf('### macOS') &&
            location.endOffset <= markdown.indexOf('## Linux')
        )
        .map(({ location }) => location.headingPath)
    ).toEqual([
      ['安装', 'Windows', 'macOS'],
      ['安装', 'Windows', 'macOS'],
      ['安装', 'Windows', 'macOS']
    ])
    for (const title of ['## Windows', '### macOS', '## Linux'])
      expect(pieces.some(({ location }) => location.startOffset === markdown.indexOf(title))).toBe(
        true
      )
  })

  it('短字符但超 token 上限的内容完整保留，且不拆开 emoji', () => {
    const markdown = '🔧漢'.repeat(20)
    const count = (text: string) => [...text].length * 3 + 2
    const pieces = [...splitEmbeddingMarkdown(doc(markdown), 64, count)]
    expect(pieces.length).toBeGreaterThan(1)
    let offset = 0
    for (const { text, location } of pieces) {
      expect(count(text)).toBeLessThanOrEqual(64)
      expect(location.startOffset).toBe(offset)
      const original = markdown.slice(location.startOffset, location.endOffset)
      expect(original).not.toMatch(/\p{Surrogate}/u)
      offset = location.endOffset
    }
    expect(offset).toBe(markdown.length)
  })
})
