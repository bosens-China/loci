import { describe, expect, it } from 'vitest'
import { rewriteGithubMarkdown } from '../github-markdown.js'

const context = {
  repository: {
    owner: 'vuejs',
    repo: 'docs',
    url: 'https://github.com/vuejs/docs',
    identity: 'github:vuejs/docs'
  },
  revision: 'abc123',
  relativePath: 'src/guide/start.md'
}

describe('rewriteGithubMarkdown', () => {
  it('rewrites relative images, links and definitions against the commit', () => {
    const markdown = [
      '![logo](../images/logo.png)',
      '',
      '[next](./next.md#usage)',
      '',
      '[root]: /README.md',
      '',
      '[external](https://example.com)',
      '',
      '```md',
      '![unchanged](./code.png)',
      '```'
    ].join('\n')

    const result = rewriteGithubMarkdown(markdown, context)

    expect(result).toContain(
      'https://raw.githubusercontent.com/vuejs/docs/abc123/src/images/logo.png'
    )
    expect(result).toContain('https://github.com/vuejs/docs/blob/abc123/src/guide/next.md#usage')
    expect(result).toContain('[root]: https://github.com/vuejs/docs/blob/abc123/README.md')
    expect(result).toContain('[external](https://example.com)')
    expect(result).toContain('![unchanged](./code.png)')
  })

  it('preserves YAML frontmatter instead of serializing it as thematic breaks', () => {
    const markdown = '---\ntitle: Hello\nsidebar: false\n---\n\n# Hi\n'

    expect(rewriteGithubMarkdown(markdown, context)).toBe(markdown)
  })
})
