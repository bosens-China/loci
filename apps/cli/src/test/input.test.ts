import { describe, expect, it } from 'vitest'
import { validatePublicUrl } from '../input.js'

describe('CLI URL 输入校验', () => {
  it('只接受 HTTP 和 HTTPS 页面', () => {
    expect(validatePublicUrl('https://example.com/docs')).toBeUndefined()
    expect(validatePublicUrl('file:///tmp/docs')).toContain('HTTP')
    expect(validatePublicUrl('not a url')).toContain('有效')
  })
})
