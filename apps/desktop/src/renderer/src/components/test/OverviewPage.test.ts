import { describe, expect, it } from 'vitest'
import type { DocumentItem, DocumentSource } from '@/types'

const mockSource: DocumentSource = {
  id: 'source-1',
  name: 'React 官方文档',
  url: 'https://react.dev',
  mode: 'auto',
  status: 'healthy',
  pages: 120,
  contentSize: 1024 * 1024,
  pageLimit: 1000,
  scopePath: '/',
  lastUpdated: '2026-08-01 10:00:00',
  schedule: null,
  httpConcurrency: null,
  browserConcurrency: null,
  iconUrl: 'https://react.dev/favicon.ico',
  cloud: null,
  kind: 'web',
  githubArchiveLimitMb: null,
  githubMarkdownLimitMb: null,
  githubDefaultBranch: null,
  githubRevision: null
}

const mockDoc: DocumentItem = {
  id: 'doc-1',
  sourceId: 'source-1',
  sourceName: 'React 官方文档',
  title: 'useState 钩子使用指南',
  url: 'https://react.dev/reference/react/useState',
  folder: 'reference/react',
  language: 'zh-CN',
  updatedAt: '2026-08-01 11:30:00',
  content: '# useState\n状态管理钩子'
}

describe('Overview Component Data Helpers', () => {
  it('correctly calculates source page completion percentage', () => {
    const percent = Math.min(
      100,
      Math.round((mockSource.pages / (mockSource.pageLimit || 1000)) * 100)
    )
    expect(percent).toBe(12)
  })

  it('sorts recent documents by updatedAt descending', () => {
    const olderDoc: DocumentItem = {
      ...mockDoc,
      id: 'doc-2',
      updatedAt: '2026-07-20 09:00:00'
    }

    const docs = [olderDoc, mockDoc]
    const sorted = [...docs].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    expect(sorted[0].id).toBe('doc-1')
    expect(sorted[1].id).toBe('doc-2')
  })
})
