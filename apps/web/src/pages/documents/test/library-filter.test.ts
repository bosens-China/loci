import { describe, expect, it } from 'vitest'
import type { DocumentSource } from '@loci/shared'
import { countLocalLibrarySources, filterLocalLibrarySources } from '../library-filter'

function source(
  input: Pick<DocumentSource, 'id' | 'name' | 'url' | 'kind'> & Partial<DocumentSource>
): DocumentSource {
  return {
    mode: 'auto',
    status: 'healthy',
    pages: 0,
    contentSize: 0,
    pageLimit: 1000,
    scopePath: '/',
    excludePathPattern: null,
    lastUpdated: '',
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null,
    iconUrl: null,
    cloud: null,
    githubArchiveLimitMb: null,
    githubMarkdownLimitMb: null,
    githubDefaultBranch: null,
    githubRevision: null,
    discoveryMode: 'site',
    resolvedDiscovery: 'pages',
    reviewGoal: null,
    ...input
  }
}

const mockSources: DocumentSource[] = [
  source({
    id: 'src-1',
    name: 'Hono 官方文档',
    url: 'https://hono.dev/docs',
    kind: 'web'
  }),
  source({
    id: 'src-2',
    name: 'honojs/hono',
    url: 'https://github.com/honojs/hono',
    kind: 'github'
  }),
  source({
    id: 'src-3',
    name: 'React 官方教程 (云端)',
    url: 'https://react.dev/learn',
    kind: 'web',
    cloud: {
      serverUrl: 'https://loci.xiaowo.live',
      libraryId: 'lib-react',
      revision: 'rev-1',
      autoSync: true
    }
  })
]

describe('本地文档库过滤与计数', () => {
  it('正确统计各类文档库数量', () => {
    const counts = countLocalLibrarySources(mockSources)
    expect(counts).toEqual({
      total: 3,
      web: 1, // 普通站点（排除云端副本）
      github: 1,
      cloud: 1
    })
  })

  it('按类型过滤文档库', () => {
    // 全部
    expect(filterLocalLibrarySources(mockSources, { kind: 'all', keyword: '' })).toHaveLength(3)

    // 普通站点
    const webOnly = filterLocalLibrarySources(mockSources, { kind: 'web', keyword: '' })
    expect(webOnly).toHaveLength(1)
    expect(webOnly[0].id).toBe('src-1')

    // GitHub 仓库
    const githubOnly = filterLocalLibrarySources(mockSources, { kind: 'github', keyword: '' })
    expect(githubOnly).toHaveLength(1)
    expect(githubOnly[0].id).toBe('src-2')

    // 云端副本
    const cloudOnly = filterLocalLibrarySources(mockSources, { kind: 'cloud', keyword: '' })
    expect(cloudOnly).toHaveLength(1)
    expect(cloudOnly[0].id).toBe('src-3')
  })

  it('按类型与关键字组合过滤', () => {
    // 搜 "hono" 在全部类型
    expect(filterLocalLibrarySources(mockSources, { kind: 'all', keyword: 'hono' })).toHaveLength(2)

    // 搜 "hono" 在 GitHub 类型
    const filteredGithub = filterLocalLibrarySources(mockSources, {
      kind: 'github',
      keyword: 'hono'
    })
    expect(filteredGithub).toHaveLength(1)
    expect(filteredGithub[0].id).toBe('src-2')

    // 搜 "react" 在 GitHub 类型 -> 空
    expect(
      filterLocalLibrarySources(mockSources, { kind: 'github', keyword: 'react' })
    ).toHaveLength(0)

    // 搜 "react" 在全部类型 -> 1
    expect(filterLocalLibrarySources(mockSources, { kind: 'all', keyword: 'react' })).toHaveLength(
      1
    )
  })
})
