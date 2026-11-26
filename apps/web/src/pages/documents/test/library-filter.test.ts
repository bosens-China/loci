import { describe, expect, it } from 'vitest'
import type { LibrarySummary } from '@loci/shared'
import { countLocalLibrarySources, filterLocalLibrarySources } from '../library-filter'

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

describe('本地文档库过滤与计数', () => {
  it('正确统计各类文档库数量', () => {
    const counts = countLocalLibrarySources(mockSources)
    expect(counts).toEqual({
      total: 3,
      web: 2,
      github: 1
    })
  })

  it('按关键词匹配名称、URL 或 ID', () => {
    const res = filterLocalLibrarySources(mockSources, { kind: 'all', keyword: 'hono' })
    expect(res).toHaveLength(2)
    expect(res.map((r) => r.id)).toEqual(['src-1', 'src-2'])
  })

  it('分类与关键词组合匹配，排除未分类的同名库', () => {
    const rows = filterLocalLibrarySources(mockSources, {
      kind: 'all',
      category: '后端',
      keyword: 'HONO'
    })
    expect(rows.map(({ id }) => id)).toEqual(['src-1'])
    expect(
      filterLocalLibrarySources(mockSources, { kind: 'all', category: '后端', keyword: 'React' })
    ).toEqual([])
  })

  it('支持类型与关键词同时过滤', () => {
    const res = filterLocalLibrarySources(mockSources, { kind: 'web', keyword: 'react' })
    expect(res).toHaveLength(1)
    expect(res[0]?.id).toBe('src-3')
  })
})
