import { buildUrlTree, type DocumentSummary, type UrlTreeNode } from '@loci/shared'

/** 保留有效选择；首次打开或原文档消失时改为当前列表首篇。 */
export function resolveDocumentSelection(
  documents: readonly DocumentSummary[] | undefined,
  selectedId: string
): string {
  if (!documents?.length) return ''
  if (documents.some((document) => document.id === selectedId)) return selectedId
  return firstReadableDocumentId(documents)
}

function firstReadableDocumentId(documents: readonly DocumentSummary[]): string {
  const [firstDocument] = documents
  if (!firstDocument) return ''
  return findReadableId(buildUrlTree(documents, firstDocument.sourceId)) ?? ''
}

function findReadableId(nodes: readonly UrlTreeNode[]): string | undefined {
  for (const node of nodes) {
    if (node.readable) return node.id
    const childId = node.children && findReadableId(node.children)
    if (childId) return childId
  }
  return undefined
}
