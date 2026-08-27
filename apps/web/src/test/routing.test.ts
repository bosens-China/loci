import { describe, expect, it } from 'vitest'
import { canonicalDocumentSearch, parseDocumentSearch } from '@/routing'

describe('Web 路由兼容性', () => {
  it('把 Router 解析后的基础值恢复为文档工作区字符串', () => {
    expect(
      parseDocumentSearch({ source: 42, doc: true, q: ['ignored'], document: 'legacy' })
    ).toEqual({ source: '42', doc: 'true', q: undefined, document: 'legacy' })
  })

  it('规范化旧 document 参数并优先保留 doc', () => {
    expect(canonicalDocumentSearch({ source: 'source', document: 'legacy', q: '' })).toEqual({
      source: 'source',
      doc: 'legacy'
    })
    expect(canonicalDocumentSearch({ doc: 'current', document: 'legacy' })).toEqual({
      doc: 'current'
    })
  })
})
