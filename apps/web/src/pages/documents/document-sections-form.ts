import type { DocumentSectionDetail, EditDocumentSectionInput } from '@loci/shared'

/** 生成新增小节请求参数，携带最新文档版本号。 */
export function createSectionAddInput(
  values: { heading: string; level: number; content: string },
  expectedUpdatedAt?: string
): EditDocumentSectionInput {
  return {
    action: 'add',
    heading: values.heading.trim(),
    level: values.level,
    content: values.content,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {})
  }
}

/** 生成修改小节请求参数，使用纯正文 body 并携带对应小节版本号。 */
export function createSectionUpdateInput(
  section: DocumentSectionDetail,
  values: { heading: string; level: number; content: string }
): EditDocumentSectionInput {
  return {
    action: 'update',
    sectionId: section.id,
    heading: values.heading.trim(),
    level: values.level,
    content: values.content,
    expectedUpdatedAt: section.updatedAt
  }
}

/** 生成删除小节请求参数，携带版本号防止过期误删。 */
export function createSectionDeleteInput(section: DocumentSectionDetail): EditDocumentSectionInput {
  return {
    action: 'delete',
    sectionId: section.id,
    expectedUpdatedAt: section.updatedAt
  }
}
