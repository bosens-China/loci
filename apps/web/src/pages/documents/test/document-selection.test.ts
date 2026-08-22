import { describe, expect, it } from 'vitest'
import { resolveDocumentSelection } from '@/pages/documents/document-selection'

const documents = [
  {
    id: 'later-in-response',
    sourceId: 'source',
    sourceName: '文档库',
    title: 'Z guide',
    url: 'https://example.com/advanced',
    folder: '文档库',
    language: 'zh-CN',
    updatedAt: '2026/8/22'
  },
  {
    id: 'first-in-tree',
    sourceId: 'source',
    sourceName: '文档库',
    title: 'A guide',
    url: 'https://example.com/start',
    folder: '文档库',
    language: 'zh-CN',
    updatedAt: '2026/8/22'
  }
]

describe('文档工作区选择', () => {
  it('首次打开或原文档缺失时选择列表首篇', () => {
    expect(resolveDocumentSelection(documents, '')).toBe('first-in-tree')
    expect(resolveDocumentSelection(documents, 'missing')).toBe('first-in-tree')
  })

  it('保留来源内已访问且仍存在的文档', () => {
    expect(resolveDocumentSelection(documents, 'later-in-response')).toBe('later-in-response')
  })
})
