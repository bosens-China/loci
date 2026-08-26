import { describe, expect, it } from 'vitest'
import { scopePathContains } from '../source-url.js'

describe('文档源收录范围', () => {
  it('按路径段判断收录范围包含关系', () => {
    expect(scopePathContains('/', '/docs')).toBe(true)
    expect(scopePathContains('/docs', '/docs/api')).toBe(true)
    expect(scopePathContains('/docs/', '/docs')).toBe(true)
    expect(scopePathContains('/doc', '/docs')).toBe(false)
    expect(scopePathContains('/docs/api', '/docs')).toBe(false)
  })
})
