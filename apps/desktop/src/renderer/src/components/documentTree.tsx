import { DatabaseOutlined, FileMarkdownOutlined, FolderOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { buildUrlTree, type UrlTreeNode } from '@shared/url-tree'
import type { DocumentItem } from '../types'

export function filterDocumentsByMarkdown(
  documents: readonly DocumentItem[],
  query: string
): readonly DocumentItem[] {
  const keyword = query.trim().toLowerCase()
  return keyword
    ? documents.filter((document) => document.content.toLowerCase().includes(keyword))
    : documents
}

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
    icon: <DatabaseOutlined className="text-blue-500 shrink-0" />,
    children: buildUrlTree(source.documents, sourceId).map(toDataNode)
  }))
}

function toDataNode(node: UrlTreeNode): DataNode {
  return {
    title: node.title,
    key: node.id,
    selectable: node.readable,
    isLeaf: node.readable,
    icon: node.readable ? (
      <FileMarkdownOutlined className="text-emerald-500 shrink-0" />
    ) : (
      <FolderOutlined className="text-amber-500 shrink-0" />
    ),
    children: node.children?.map(toDataNode)
  }
}

export function getAncestorKeysForDocument(
  documents: readonly DocumentItem[],
  selectedId?: string
): string[] {
  if (!selectedId) return []
  const doc = documents.find((d) => d.id === selectedId)
  if (!doc) return []

  const keys: string[] = [`source:${doc.sourceId}`]
  if (doc.folder) {
    const parts = doc.folder.split('/').filter(Boolean)
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      keys.push(`folder:${doc.sourceId}:${currentPath}`)
    }
  }
  return keys
}
