import type { DocumentDetail, UpdateDocumentInput } from '@loci/shared'

/**
 * 比较原详情与表单输入，只提交实际修改的字段，并传入 expectedUpdatedAt。
 * 当仅修改标题时，正文字段不会被提交，避免超长正文被截断覆盖。
 */
export function calculateDocumentUpdate(
  original: DocumentDetail,
  values: { title: string; content: string; language?: string }
): UpdateDocumentInput {
  const updateInput: UpdateDocumentInput = {
    expectedUpdatedAt: original.updatedAt
  }
  const trimmedTitle = values.title.trim()
  if (trimmedTitle !== original.title) {
    updateInput.title = trimmedTitle
  }
  if (values.content !== original.content) {
    updateInput.content = values.content
  }
  if (values.language && values.language !== original.language) {
    updateInput.language = values.language
  }
  return updateInput
}
