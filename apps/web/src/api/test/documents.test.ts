import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { editDocumentSection, updateDocument } from '@/api/documents'

afterEach(() => vi.restoreAllMocks())

describe('文档详情与小节 API 契约', () => {
  it('updateDocument: 支持仅提交修改字段与 expectedUpdatedAt 进行并发乐观锁控制', async () => {
    const put = vi.spyOn(request, 'put').mockResolvedValue({
      data: { id: 'doc-100', title: '新标题' }
    })

    await updateDocument('doc-100', {
      title: '新标题',
      expectedUpdatedAt: '2026-11-26T10:00:00.000Z'
    })

    expect(put).toHaveBeenCalledWith('/api/documents/doc-100', {
      title: '新标题',
      expectedUpdatedAt: '2026-11-26T10:00:00.000Z'
    })
  })

  it('editDocumentSection: 调用 POST /api/documents/:docId/sections 携带 expectedUpdatedAt', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValue({
      data: { id: 'doc-100' }
    })

    await editDocumentSection('doc-100', {
      action: 'update',
      sectionId: 'sec-1',
      heading: '更新小节标题',
      level: 2,
      content: '更新后正文',
      expectedUpdatedAt: '2026-11-26T10:00:00.000Z'
    })

    expect(post).toHaveBeenCalledWith('/api/documents/doc-100/sections', {
      action: 'update',
      sectionId: 'sec-1',
      heading: '更新小节标题',
      level: 2,
      content: '更新后正文',
      expectedUpdatedAt: '2026-11-26T10:00:00.000Z'
    })
  })
})
