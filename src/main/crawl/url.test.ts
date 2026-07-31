import { describe, expect, it } from 'vitest'
import { getHostname, isAllowedNavigation, isSameHostname, normalizeUrl } from './url'

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
})
