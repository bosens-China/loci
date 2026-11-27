import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DocumentReadResult, DocumentRecord } from '@loci/shared'
import { DocumentReaderPanel } from '../DocumentReaderPanel'
import { normalizeReaderMarkdown, readerTitle, resolveReaderUrl } from '../reader-markdown'

const document: DocumentRecord = {
  id: 'guide',
  sourceId: 'vue',
  sourceName: 'Vue',
  title: 'Guide',
  url: 'https://vuejs.org/api/reactivity-core.md',
  folder: 'api',
  language: 'en',
  updatedAt: '2026-01-01',
  content: ''
}
const panel = { loading: false, error: null, onRetry: () => {} }

describe('文档阅读视图边界', () => {
  it('按来源解析链接和图片，不把相对路径交给控制台', () => {
    const source = 'https://react.dev/learn.md'
    expect(resolveReaderUrl('/reference/react', source)).toBe('https://react.dev/reference/react')
    expect(resolveReaderUrl('./images/demo.png', source)).toBe('https://react.dev/images/demo.png')
    expect(resolveReaderUrl('../learn.md?q=1#intro', 'https://react.dev/reference/react.md')).toBe(
      'https://react.dev/learn.md?q=1#intro'
    )
    expect(resolveReaderUrl('#intro', source)).toBe('#doc-intro')
    expect(resolveReaderUrl('mailto:docs@example.com', source)).toBe('mailto:docs@example.com')
  })

  it('保留默认协议保护，不允许脚本和 data URL', () => {
    for (const value of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd'
    ]) {
      expect(resolveReaderUrl(value, 'https://react.dev/learn.md')).toBe('')
    }
    expect(resolveReaderUrl('relative', 'invalid')).toBe('')
  })

  it('隐藏展示包装并保留正文、原始内容和代码示例', () => {
    const code = '```tsx\n<Intro>example</Intro>\n{/* keep code */}\n```'
    const source = [
      '---',
      'title: Quick Start',
      '---',
      '<Intro>',
      'Hello **React**.',
      '</Intro> <YouWillLearn>',
      '- State',
      '</YouWillLearn>',
      '<Sandpack>',
      code,
      '</Sandpack>',
      'Inline `<Intro>` and ``<Sandpack>``.',
      '    <Intro>indented example</Intro>',
      '## State {/*state*/}'
    ].join('\n')
    const result = normalizeReaderMarkdown(source)
    expect(result).toContain('Hello **React**.')
    expect(result).toContain('- State')
    expect(result).toContain(code)
    expect(result).toContain('Inline `<Intro>` and ``<Sandpack>``.')
    expect(result).toContain('    <Intro>indented example</Intro>')
    expect(result).not.toContain('title: Quick Start')
    expect(result).not.toContain('<YouWillLearn>')
    expect(result).not.toContain('{/*state*/}')
    expect(source).toContain('title: Quick Start')
    expect(source).toContain('<YouWillLearn>')
  })

  it('不误删未闭合的头部和波浪围栏内的源站标记', () => {
    expect(normalizeReaderMarkdown('---\ntitle: incomplete')).toBe('---\ntitle: incomplete')
    expect(normalizeReaderMarkdown('---\nOrdinary paragraph\n---')).toBe(
      '---\nOrdinary paragraph\n---'
    )
    expect(normalizeReaderMarkdown('Example ``a`<Intro>`b``.')).toBe('Example ``a`<Intro>`b``.')
    const code = '~~~~mdx\n<Intro>code</Intro>\n~~~\n<Sandpack />\n~~~~'
    expect(normalizeReaderMarkdown(code)).toBe(code)
  })

  it('Vue 自定义标题锚点可跳转，提示块和代码的正文保持完整', () => {
    const source =
      '# Core {#core}\n\n:::info See also\nRead [reactive](#reactive).\n:::\n\n## `reactive()` {#reactive}\n\n```md\n:::tip\n# Example {#example}\n:::<Intro>\n```\n\n## Repeated\n## Repeated'
    const content = normalizeReaderMarkdown(source)
    const html = renderToStaticMarkup(
      createElement(DocumentReaderPanel, { ...panel, document: { ...document, content: source } })
    )
    expect(html).toContain('id="doc-reactive"')
    expect(html).toContain('href="#doc-reactive"')
    expect(html).toContain('<code>reactive()</code>')
    expect(html).toContain('id="doc-repeated-1"')
    expect(html).not.toContain('{#reactive}')
    expect(content).toContain('Read [reactive](#reactive).')
    expect(content).not.toContain(':::info')
    expect(content).toContain(':::tip\n# Example {#example}\n:::<Intro>')
    expect(readerTitle('Core {#core}')).toBe('Core')
    expect(source).toContain(':::info')
  })

  it('多选预览分别解析每篇文档的相对图片和同名标题锚点', () => {
    const content = '## Intro\n\n[Jump](#intro) ![Demo](./demo.png)'
    const previews: DocumentReadResult[] = ['first', 'second'].map((id) => ({
      ...document,
      id,
      path: '/guide.md',
      url: `https://${id}.test/guide.md`,
      content,
      offset: 0,
      totalChars: content.length,
      truncated: false
    }))
    const html = renderToStaticMarkup(
      createElement(DocumentReaderPanel, { ...panel, document: null, multipleDocuments: previews })
    )
    for (const { id } of previews) {
      expect(html).toContain(`href="#doc-${id}-intro"`)
      expect(html).toContain(`id="doc-${id}-intro"`)
      expect(html).toContain(`src="https://${id}.test/demo.png"`)
    }
  })
})
