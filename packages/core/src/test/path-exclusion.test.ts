import { describe, expect, it } from 'vitest'
import {
  createPathExclusionMatcher,
  isPathExcluded,
  normalizeExcludePathPattern
} from '../path-exclusion.js'

describe('路径排除正则', () => {
  it('空值关闭规则且只匹配 pathname', () => {
    expect(normalizeExcludePathPattern('  ')).toBeNull()
    const matches = createPathExclusionMatcher('^/(zh|de)(?:/|$)')
    expect(matches?.('https://docs.example.com/zh/guide?next=/en')).toBe(true)
    expect(matches?.('https://docs.example.com/en/guide?next=/zh')).toBe(false)
  })

  it('拒绝无效或过长正则', () => {
    expect(() => normalizeExcludePathPattern('[')).toThrow('格式无效')
    expect(() => normalizeExcludePathPattern('a'.repeat(501))).toThrow('不能超过')
  })

  it('支持关键词式路径匹配', () => {
    expect(isPathExcluded('https://docs.example.com/reference/private-api', 'private')).toBe(true)
  })
})
