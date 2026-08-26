import type { DocumentSource, UpdateSourceInput } from '@loci/shared'
import { describe, expect, it } from 'vitest'
import { getSourceRemovalWarning } from '../source-prompts.js'

describe('文档源修改警告', () => {
  it('只为可能立即删除正文的来源变更生成警告', () => {
    const current: DocumentSource = {
      id: 'source-1',
      name: 'Docs',
      url: 'https://example.com/docs',
      kind: 'web',
      mode: 'auto',
      status: 'healthy',
      pages: 1,
      contentSize: 10,
      pageLimit: 1000,
      scopePath: '/docs',
      excludePathPattern: null,
      lastUpdated: '2026-08-25T00:00:00.000Z',
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
      resolvedDiscovery: null,
      reviewGoal: null
    }
    const input: Omit<UpdateSourceInput, 'schedule'> = {
      name: current.name,
      url: current.url,
      mode: current.mode,
      pageLimit: current.pageLimit,
      scopePath: current.scopePath,
      excludePathPattern: current.excludePathPattern,
      httpConcurrency: current.httpConcurrency,
      browserConcurrency: current.browserConcurrency,
      githubArchiveLimitMb: current.githubArchiveLimitMb,
      githubMarkdownLimitMb: current.githubMarkdownLimitMb
    }
    expect(getSourceRemovalWarning(current, input)).toBeNull()
    expect(getSourceRemovalWarning(current, { ...input, scopePath: '/' })).toBeNull()
    expect(getSourceRemovalWarning(current, { ...input, scopePath: '/docs/api' })).toContain(
      '立即删除'
    )
    expect(
      getSourceRemovalWarning(current, { ...input, excludePathPattern: '^/docs/legacy' })
    ).toContain('立即删除')
    expect(
      getSourceRemovalWarning(
        {
          ...current,
          kind: 'github',
          url: 'https://github.com/example/docs',
          scopePath: '/'
        },
        {
          ...input,
          kind: 'github',
          url: 'https://github.com/example/other',
          scopePath: '/'
        }
      )
    ).toContain('立即清空')
  })
})
