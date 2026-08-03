import { describe, expect, it } from 'vitest'
import type { ParsedPage } from './content'
import { selectFetchMode } from './mode'

const page = (markdown: string, title = 'Docs'): ParsedPage => ({
  title,
  language: 'en-US',
  markdown,
  links: []
})

describe('selectFetchMode', () => {
  it('selects HTTP when both rendered versions are equivalent', () => {
    expect(selectFetchMode(page('# Docs\n\nHello world'), page('# Docs\n\nHello world'))).toBe(
      'http'
    )
  })

  it('selects browser when rendered content adds meaningful content', () => {
    expect(
      selectFetchMode(
        page('# Docs\n\nHello'),
        page('# Docs\n\nHello with dynamic navigation and examples')
      )
    ).toBe('browser')
  })

  it('selects browser when titles or code blocks are missing', () => {
    expect(selectFetchMode(page('# Docs\n\n```ts\nconst a = 1\n```'), page('Docs', 'Other'))).toBe(
      'browser'
    )
  })
})
