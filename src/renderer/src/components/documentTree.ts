import type { DataNode } from 'antd/es/tree'
import { buildUrlTree, type UrlTreeNode } from '@shared/url-tree'
import type { DocumentItem } from '../types'

export function buildDocumentTree(documents: readonly DocumentItem[]): DataNode[] {
  const sources = new Map<string, { name: string; documents: DocumentItem[] }>()
  for (const document of documents) {
    const source = sources.get(document.sourceId) ?? { name: document.sourceName, documents: [] }
    source.documents.push(document)
    sources.set(document.sourceId, source)
  }
  return [...sources.entries()].map(([sourceId, source]) => ({
    title: `${source.name}（${source.documents.length} 页）`,
    key: `source:${sourceId}`,
    selectable: false,
    children: buildUrlTree(source.documents, sourceId).map(toDataNode)
  }))
}

function toDataNode(node: UrlTreeNode): DataNode {
  return {
    title: node.title,
    key: node.id,
    selectable: node.readable,
    isLeaf: node.readable,
    children: node.children?.map(toDataNode)
  }
}
