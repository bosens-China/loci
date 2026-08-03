import { describe, expect, it } from 'vitest'
import { normalizeServerUrl } from './server-url'

describe('normalizeServerUrl', () => {
  it('生成可稳定比较的 HTTP 后端地址', () => {
    expect(normalizeServerUrl('HTTP://Example.COM:80/loci/')).toBe('http://example.com/loci')
    expect(() => normalizeServerUrl('https://user@example.com')).toThrow('不能包含账号')
    expect(() => normalizeServerUrl('file:///tmp/loci')).toThrow('仅支持 HTTP 或 HTTPS')
  })
})
