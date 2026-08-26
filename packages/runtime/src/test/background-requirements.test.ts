import { describe, expect, it } from 'vitest'
import type { DocumentSource } from '@loci/shared'
import { inspectPersistentBackgroundRequirements } from '../background-requirements.js'

const source: DocumentSource = {
  id: 'source-1',
  name: 'Docs',
  url: 'https://example.com/docs',
  mode: 'auto',
  status: 'healthy',
  pages: 1,
  contentSize: 10,
  pageLimit: 1000,
  scopePath: '/',
  lastUpdated: '刚刚',
  schedule: null,
  httpConcurrency: null,
  browserConcurrency: null,
  iconUrl: null,
  cloud: null,
  kind: 'web',
  githubArchiveLimitMb: null,
  githubMarkdownLimitMb: null,
  githubDefaultBranch: null,
  githubRevision: null,
  discoveryMode: 'site',
  resolvedDiscovery: null,
  reviewGoal: null
}

describe('持久后台需求', () => {
  it('统计定时文档源和自动同步云端副本', () => {
    const requirements = inspectPersistentBackgroundRequirements([
      { ...source, schedule: '0 2 * * *' },
      {
        ...source,
        id: 'cloud-1',
        cloud: {
          serverUrl: 'https://loci.example.com',
          libraryId: 'library-1',
          revision: 'revision-1',
          autoSync: true
        }
      }
    ])

    expect(requirements).toEqual({
      required: true,
      scheduledSources: 1,
      autoSyncCloudSources: 1
    })
  })

  it('普通来源和关闭自动同步的云端副本不要求常驻服务', () => {
    expect(
      inspectPersistentBackgroundRequirements([
        source,
        {
          ...source,
          id: 'cloud-1',
          cloud: {
            serverUrl: 'https://loci.example.com',
            libraryId: 'library-1',
            revision: 'revision-1',
            autoSync: false
          }
        }
      ])
    ).toEqual({ required: false, scheduledSources: 0, autoSyncCloudSources: 0 })
  })
})
