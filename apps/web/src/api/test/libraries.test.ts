import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { createLibrary, getLibraryTree, listLibraries, syncLibrary } from '@/api'
import type { CreateSourceInput, LibrarySummary } from '@loci/shared'

afterEach(() => vi.restoreAllMocks())

describe('Loci 本机轻量 API 契约', () => {
  it('正确向 /api/libraries 发送创建请求', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValue({
      data: { id: 'lib-1', name: 'React Docs' }
    })
    const input: CreateSourceInput = {
      name: 'React Docs',
      url: 'https://react.dev',
      mode: 'auto',
      pageLimit: 500,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    }

    await createLibrary(input)
    expect(post).toHaveBeenCalledWith('/api/libraries', input)
  })

  it('支持 query 过滤文档库列表', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValue({
      data: [] as LibrarySummary[]
    })
    await listLibraries('react')
    expect(get).toHaveBeenCalledWith('/api/libraries', {
      params: { query: 'react' }
    })
  })

  it('正确拼接多关键词筛选目录树参数', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValue({ data: [] })
    await getLibraryTree('lib-1', {
      parent: 'node-1',
      depth: 2,
      queries: ['hook', 'state']
    })
    expect(get).toHaveBeenCalled()
    const callArgs = get.mock.calls[0]
    expect(callArgs[0]).toBe('/api/libraries/lib-1/tree')
    const params = callArgs[1]?.params as URLSearchParams
    expect(params.get('parent')).toBe('node-1')
    expect(params.get('depth')).toBe('2')
    expect(params.getAll('queries')).toEqual(['hook', 'state'])
  })

  it('触发全量抓取时调用 /api/libraries/:id/sync', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValue({
      data: { libraryId: 'lib-1', status: 'running' }
    })
    await syncLibrary('lib-1')
    expect(post).toHaveBeenCalledWith('/api/libraries/lib-1/sync')
  })
})
