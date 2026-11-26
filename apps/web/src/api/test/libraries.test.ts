import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { getLibraryTree } from '@/api'

afterEach(() => vi.restoreAllMocks())

describe('Loci 本机轻量 API 契约', () => {
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
})
