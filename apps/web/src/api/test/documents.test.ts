import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentDetail, DocumentSectionDetail } from '@loci/shared'
import { request } from '@/api/client'
import {
  editDocumentSection,
  getDocument,
  listDocumentSections,
  updateDocument
} from '@/api/documents'

afterEach(() => vi.restoreAllMocks())

describe('文档详情与小节 API 契约', () => {
  it('getDocument: 调用 GET /api/documents/:docId 获取完整 DocumentDetail', async () => {
    const mockDetail: DocumentDetail = {
      id: 'doc-100',
      sourceId: 'lib-1',
      sourceName: 'My Lib',
      title: '完整文档',
      url: 'https://example.com/doc',
      path: '/doc.md',
      folder: '',
      language: 'markdown',
      updatedAt: '2026-11-26T10:00:00.000Z',
      content: '# 完整正文\n\n超过2万字符的大文档...'
    }

    const get = vi.spyOn(request, 'get').mockResolvedValue({ data: mockDetail })

    const result = await getDocument('doc-100')
    expect(get).toHaveBeenCalledWith('/api/documents/doc-100')
    expect(result.content).toBe(mockDetail.content)
    expect(result.updatedAt).toBe('2026-11-26T10:00:00.000Z')
  })

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

  it('listDocumentSections: 调用 GET /api/documents/:docId/sections 返回包含 pure body 和 updatedAt 的 DocumentSectionDetail[]', async () => {
    const mockSections: DocumentSectionDetail[] = [
      {
        id: 'sec-1',
        title: '小节一',
        level: 2,
        startOffset: 0,
        endOffset: 50,
        charCount: 50,
        body: '这是第一小节的纯正文',
        updatedAt: '2026-11-26T10:00:00.000Z'
      }
    ]

    const get = vi.spyOn(request, 'get').mockResolvedValue({ data: mockSections })

    const result = await listDocumentSections('doc-100')
    expect(get).toHaveBeenCalledWith('/api/documents/doc-100/sections')
    expect(result[0]?.body).toBe('这是第一小节的纯正文')
    expect(result[0]?.updatedAt).toBe('2026-11-26T10:00:00.000Z')
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
