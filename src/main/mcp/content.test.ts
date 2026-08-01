import { describe, expect, it } from 'vitest'
import { findBestPassage, readMarkdownSection, sliceContent } from './content'

describe('findBestPassage', () => {
  it('returns the best matching paragraph with its nearest heading', () => {
    expect(
      findBestPassage(
        '# 开始\n\n先安装依赖。\n\n## 响应式原理\n\n读取属性时进行依赖追踪。',
        '依赖追踪',
        '文档',
        'file-1'
      )
    ).toEqual({
      sectionId: 'file-1:section:1',
      sectionTitle: '响应式原理',
      paragraph: '读取属性时进行依赖追踪。',
      truncated: false
    })
  })

  it('reads the searched section and resumes content without overlap', () => {
    const markdown = `# 开始\n\n${'内容'.repeat(800)}\n\n## 下一节\n\n结束`
    expect(readMarkdownSection(markdown, 'file-1:section:1', 'file-1', '文档')).toEqual({
      title: '下一节',
      content: '## 下一节\n\n结束'
    })

    const first = sliceContent(markdown, 0, 1000)
    const second = sliceContent(markdown, first.nextOffset ?? 0, 1000)
    expect(first.truncated).toBe(true)
    expect(first.content + second.content).toBe(markdown)
  })
})
