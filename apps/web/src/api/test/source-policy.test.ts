import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { pullCloudLibrary } from '@/api/cloud'
import { createSource } from '@/api/sources'
import type { CreateSourceInput, CreateSourceResult } from '@loci/shared'

afterEach(() => vi.restoreAllMocks())

describe('Web 与 CLI 共享默认行为', () => {
  it('新建来源默认请求首次同步', async () => {
    const result = {
      source: { id: 'source-1' },
      sync: null,
      workerError: null
    } as unknown as CreateSourceResult
    const post = vi.spyOn(request, 'post').mockResolvedValue({ data: result })
    const input = {
      name: 'Docs',
      url: 'https://example.com/docs',
      mode: 'auto',
      pageLimit: 1000,
      scopePath: '/',
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null,
      githubArchiveLimitMb: null,
      githubMarkdownLimitMb: null
    } satisfies CreateSourceInput

    await expect(createSource(input)).resolves.toBe(result)
    expect(post).toHaveBeenCalledWith('/api/sources?sync=true', input)
  })

  it('云端拉取默认不启用每日自动同步', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValue({ data: {} })
    await pullCloudLibrary('library-1')
    expect(post).toHaveBeenCalledWith(
      '/api/cloud/libraries/library-1/pull',
      { autoSync: false },
      { timeout: 120_000 }
    )
  })
})
