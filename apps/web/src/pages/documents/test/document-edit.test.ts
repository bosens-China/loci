import { describe, expect, it } from 'vitest'
import type { DocumentDetail, DocumentSectionDetail } from '@loci/shared'
import { calculateDocumentUpdate } from '../document-edit-form'
import {
  createSectionAddInput,
  createSectionDeleteInput,
  createSectionUpdateInput
} from '../document-sections-form'

describe('P0-1: 文档整篇编辑与并发版本控制', () => {
  const longContent = 'A'.repeat(25000)
  const originalDoc: DocumentDetail = {
    id: 'doc-long-1',
    sourceId: 'lib-react',
    sourceName: 'React Docs',
    title: '长文档标题',
    url: 'https://react.dev/reference/long-doc',
    path: '/reference/long-doc.md',
    folder: 'reference',
    language: 'markdown',
    updatedAt: '2026-11-26T08:30:00.000Z',
    content: longContent
  }

  it('长文档只修改标题时：不会提交未改动的长正文（避免截断覆写），且附带 expectedUpdatedAt', () => {
    const patch = calculateDocumentUpdate(originalDoc, {
      title: '更新后的标题',
      content: longContent, // 正文未变
      language: 'markdown'
    })

    expect(patch.title).toBe('更新后的标题')
    expect(patch.content).toBeUndefined() // 确保未修改的正文不被重新发送
    expect(patch.expectedUpdatedAt).toBe('2026-11-26T08:30:00.000Z')
  })

  it('修改正文时：提交完整正文与 expectedUpdatedAt', () => {
    const updatedContent = longContent + '\n\n追加内容'
    const patch = calculateDocumentUpdate(originalDoc, {
      title: '长文档标题',
      content: updatedContent,
      language: 'markdown'
    })

    expect(patch.title).toBeUndefined()
    expect(patch.content).toBe(updatedContent)
    expect(patch.content?.length).toBeGreaterThan(20000)
    expect(patch.expectedUpdatedAt).toBe('2026-11-26T08:30:00.000Z')
  })
})

describe('P0-2 & P1-1: 小节编辑与并发版本控制', () => {
  const mockSection: DocumentSectionDetail = {
    id: 'sec-doc1-1',
    title: '基础配置',
    level: 2,
    startOffset: 25,
    endOffset: 320,
    charCount: 295,
    body: '这是该小节的纯正文内容，不包含 ## 基础配置 标题行。',
    updatedAt: '2026-11-26T09:15:00.000Z'
  }

  it('小节编辑：原样保存提交纯 body，不重复拼接标题行，并携带 expectedUpdatedAt', () => {
    const input = createSectionUpdateInput(mockSection, {
      heading: mockSection.title,
      level: mockSection.level,
      content: mockSection.body
    })

    expect(input.action).toBe('update')
    expect(input.sectionId).toBe('sec-doc1-1')
    expect(input.heading).toBe('基础配置')
    expect(input.level).toBe(2)
    // 提交的正文内容绝不包含标题前缀，避免造成标题重复
    expect(input.content).toBe('这是该小节的纯正文内容，不包含 ## 基础配置 标题行。')
    expect(input.content?.startsWith('#')).toBe(false)
    expect(input.expectedUpdatedAt).toBe('2026-11-26T09:15:00.000Z')
  })

  it('小节新增：提交时携带文档最新 expectedUpdatedAt', () => {
    const input = createSectionAddInput(
      {
        heading: '新小节',
        level: 3,
        content: '新小节正文内容'
      },
      '2026-11-26T09:15:00.000Z'
    )

    expect(input.action).toBe('add')
    expect(input.heading).toBe('新小节')
    expect(input.level).toBe(3)
    expect(input.content).toBe('新小节正文内容')
    expect(input.expectedUpdatedAt).toBe('2026-11-26T09:15:00.000Z')
  })

  it('小节删除：提交时携带对应小节 expectedUpdatedAt 防跨进程过期覆盖', () => {
    const input = createSectionDeleteInput(mockSection)

    expect(input.action).toBe('delete')
    expect(input.sectionId).toBe('sec-doc1-1')
    expect(input.expectedUpdatedAt).toBe('2026-11-26T09:15:00.000Z')
  })
})
