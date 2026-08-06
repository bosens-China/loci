import { describe, expect, it } from 'vitest'
import {
  getHostname,
  isAllowedNavigation,
  isSameHostname,
  isUrlInScope,
  normalizeScopePath,
  normalizeUrl
} from '@loci/core'

describe('normalizeUrl', () => {
  it('removes query parameters and fragments', () => {
    expect(normalizeUrl('https://example.com/docs?a=1#intro')).toBe('https://example.com/docs')
  })

  it('rejects non-http protocols', () => {
    expect(() => normalizeUrl('file:///tmp/docs')).toThrow('只支持 HTTP 或 HTTPS')
  })

  it('compares hostnames without allowing subdomains', () => {
    expect(getHostname('https://docs.example.com/start')).toBe('docs.example.com')
    expect(isSameHostname('https://docs.example.com/next', 'docs.example.com')).toBe(true)
    expect(isSameHostname('https://api.example.com/next', 'docs.example.com')).toBe(false)
  })

  it('only allows HTTP navigation within the configured hostname', () => {
    expect(isAllowedNavigation('https://docs.example.com/next', 'docs.example.com')).toBe(true)
    expect(isAllowedNavigation('https://other.example.com/next', 'docs.example.com')).toBe(false)
    expect(isAllowedNavigation('file:///tmp/docs', 'docs.example.com')).toBe(false)
  })

  it('按路径段边界限制收录范围', () => {
    expect(normalizeScopePath('/guide/')).toBe('/guide')
    expect(isUrlInScope('https://docs.example.com/guide/start', 'docs.example.com', '/guide')).toBe(
      true
    )
    expect(isUrlInScope('https://docs.example.com/guidebook', 'docs.example.com', '/guide')).toBe(
      false
    )
    expect(
      isUrlInScope('https://docs.example.com/guide/start.md', 'docs.example.com', '/guide/start')
    ).toBe(true)
    expect(isAllowedNavigation('https://docs.example.com/api', 'docs.example.com', '/guide')).toBe(
      false
    )
  })
})
