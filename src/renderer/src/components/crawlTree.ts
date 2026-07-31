import type { CrawlNode, CrawlNodeStatus } from '../types'

export interface CrawlTreeNode {
  id: string
  name: string
  status: CrawlNodeStatus
  url: string
  children: CrawlTreeNode[]
}

export function buildCrawlTree(nodes: readonly CrawlNode[]): CrawlTreeNode | undefined {
  const root = nodes[0]
  if (!root) return undefined

  const treeNodes = new Map<string, CrawlTreeNode>(
    nodes.map((node): [string, CrawlTreeNode] => [
      node.id,
      {
        id: node.id,
        name: node.title,
        status: node.status,
        url: node.url,
        children: []
      }
    ])
  )
  const rootNode = treeNodes.get(root.id)
  if (!rootNode) return undefined

  for (const node of nodes) {
    if (node.id === root.id) continue
    const child = treeNodes.get(node.id)
    const parent = node.parentId === node.id ? undefined : treeNodes.get(node.parentId ?? '')
    if (child) (parent ?? rootNode).children.push(child)
  }
  return rootNode
}
