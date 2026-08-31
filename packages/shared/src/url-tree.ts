export interface UrlTreeItem {
  id: string
  title: string
  url: string
  relativePath?: string
  path?: string
}

export interface UrlTreeNode {
  id: string
  title: string
  readable: boolean
  children?: UrlTreeNode[]
}

// 派生文档和仓库文档优先使用逻辑相对路径；普通网页继续按 URL 路径展示。
export function buildUrlTree(items: readonly UrlTreeItem[], namespace: string): UrlTreeNode[] {
  const roots: UrlTreeNode[] = []
  for (const item of items) {
    const logicalPath = item.relativePath ?? item.path ?? new URL(item.url).pathname
    const segments = logicalPath.split(/[\\/]/u).filter(Boolean)
    let children = roots
    const path: string[] = []
    for (const segment of segments.slice(0, -1)) {
      path.push(segment)
      const id = `folder:${namespace}:${path.join('/')}`
      let folder = children.find((node) => node.id === id)
      if (!folder) {
        folder = { id, title: segment, readable: false, children: [] }
        children.push(folder)
      }
      children = folder.children ?? []
    }
    children.push({ id: item.id, title: item.title, readable: true })
  }
  return sortTree(roots)
}

export function getUrlTreeSlice(
  roots: readonly UrlTreeNode[],
  parentId: string | undefined,
  depth: number
): UrlTreeNode[] | undefined {
  const children = parentId ? findNode(roots, parentId)?.children : roots
  return children?.map((node) => limitDepth(node, depth))
}

function findNode(nodes: readonly UrlTreeNode[], id: string): UrlTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = node.children && findNode(node.children, id)
    if (match) return match
  }
  return undefined
}

function limitDepth(node: UrlTreeNode, depth: number): UrlTreeNode {
  const children =
    depth > 1 ? node.children?.map((child) => limitDepth(child, depth - 1)) : undefined
  return {
    id: node.id,
    title: node.title,
    readable: node.readable,
    ...(children ? { children } : {})
  }
}

function sortTree(nodes: UrlTreeNode[]): UrlTreeNode[] {
  for (const node of nodes) {
    if (node.children) sortTree(node.children)
  }
  return nodes.sort(
    (left, right) =>
      Number(left.readable) - Number(right.readable) || left.title.localeCompare(right.title)
  )
}
