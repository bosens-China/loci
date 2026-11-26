import { describe, expect, it } from 'vitest'
import type { LibrarySummary } from '@loci/shared'
import { filterLocalLibrarySources } from '../library-filter'

function createSummary(
  input: Pick<LibrarySummary, 'id' | 'name' | 'url' | 'kind'> & Partial<LibrarySummary>
): LibrarySummary {
  return {
    category: '未分类',
    version: 'latest',
    mode: 'auto',
    status: 'healthy',
    pages: 0,
    pageCount: 10,
    languages: ['TypeScript'],
    contentSize: 0,
    pageLimit: 1000,
    scopePath: '/',
    excludePathPattern: null,
    readOnly: false,
    updatedAt: '',
    lastUpdated: '',
    httpConcurrency: null,
    browserConcurrency: null,
    iconUrl: null,
    githubArchiveLimitMb: null,
    githubMarkdownLimitMb: null,
    githubDefaultBranch: null,
    githubRevision: null,
    resolvedDiscovery: 'pages',
    ...input
  }
}

const mockSources: LibrarySummary[] = [
  createSummary({
    id: 'src-1',
    category: '后端',
    name: 'Hono 官方文档',
    url: 'https://hono.dev/docs',
    kind: 'web'
  }),
  createSummary({
    id: 'src-2',
    name: 'honojs/hono',
    url: 'https://github.com/honojs/hono',
    kind: 'github'
  }),
  createSummary({
    id: 'src-3',
    name: 'React 官方教程',
    url: 'https://react.dev/learn',
    kind: 'web'
  })
]

describe('本地文档库过滤', () => {
  it('支持类型、分类与关键词多维度组合过滤', () => {
    const rows = filterLocalLibrarySources(mockSources, {
      kind: 'web',
      category: '后端',
      keyword: 'HONO'
    })
    expect(rows.map(({ id }) => id)).toEqual(['src-1'])

    expect(filterLocalLibrarySources(mockSources, { kind: 'github', keyword: 'react' })).toEqual([])
  })
})
