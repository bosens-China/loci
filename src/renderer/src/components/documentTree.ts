import type { DataNode } from 'antd/es/tree'
import type { DocumentItem } from '../types'

export function buildDocumentTree(documents: readonly DocumentItem[]): DataNode[] {
  const sourceCounts = new Map<string, number>()
  for (const document of documents) {
    sourceCounts.set(document.sourceId, (sourceCounts.get(document.sourceId) ?? 0) + 1)
  }

  const groups = new Map<string, DataNode>()
  for (const document of documents) {
    let sourceNode = groups.get(document.sourceId)
    if (!sourceNode) {
      sourceNode = {
        title: `${document.sourceName}（${sourceCounts.get(document.sourceId)} 页）`,
        key: `source:${document.sourceId}`,
        selectable: false,
        children: []
      }
      groups.set(document.sourceId, sourceNode)
    }

    const segments = new URL(document.url).pathname.split('/').filter(Boolean)
    let parent = sourceNode
    const path: string[] = []
    for (const segment of segments.slice(0, -1)) {
      path.push(segment)
      const key = `folder:${document.sourceId}:${path.join('/')}`
      const children = parent.children ?? []
      let folder = children.find((item) => item.key === key)
      if (!folder) {
        folder = { title: segment, key, selectable: false, children: [] }
        children.push(folder)
        parent.children = children
      }
      parent = folder
    }
    parent.children = [
      ...(parent.children ?? []),
      { title: document.title, key: document.id, isLeaf: true }
    ]
  }
  return [...groups.values()]
}
