import { describe, expect, it } from 'vitest'
import type { ResourceRevisions, ServerResourceRevisions } from '@loci/shared'
import {
  getChangedQueryKeys,
  LOCAL_QUERY_KEYS,
  SERVER_QUERY_KEYS
} from '@/hooks/use-resource-events'

const localInitial: ResourceRevisions = {
  sources: 1,
  documents: 2,
  jobs: 3,
  settings: 4,
  logs: 5
}
const serverInitial: ServerResourceRevisions = {
  libraries: 1,
  jobs: 2,
  hostnamePolicies: 3,
  crawlSettings: 4,
  auditLogs: 5
}

describe('SSE revision Query 映射', () => {
  it('首次事件只建立基线，不重复请求页面数据', () => {
    expect(getChangedQueryKeys(undefined, localInitial, LOCAL_QUERY_KEYS)).toEqual([])
  })

  it('本地日志 revision 仅失效操作日志缓存', () => {
    expect(
      getChangedQueryKeys(localInitial, { ...localInitial, logs: 6 }, LOCAL_QUERY_KEYS)
    ).toEqual([['operation-logs']])
  })

  it('Server 文档库 revision 同步失效管理与公开目录缓存', () => {
    expect(
      getChangedQueryKeys(serverInitial, { ...serverInitial, libraries: 6 }, SERVER_QUERY_KEYS)
    ).toEqual([['admin-libraries'], ['cloud-catalog'], ['library-tree'], ['library-file']])
  })
})
