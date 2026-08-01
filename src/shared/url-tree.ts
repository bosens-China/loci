export interface UrlTreeItem {
  id: string
  title: string
  url: string
}

export interface UrlTreeNode {
  id: string
  title: string
  readable: boolean
  children?: UrlTreeNode[]
}

// URL 路径只是目录来源，真正可读取的节点始终使用数据库中的文件 ID。
export function buildUrlTree(items: readonly UrlTreeItem[], namespace: string): UrlTreeNode[] {
  const roots: UrlTreeNode[] = []
  for (const item of items) {
    const segments = new URL(item.url).pathname.split('/').filter(Boolean)
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

function sortTree(nodes: UrlTreeNode[]): UrlTreeNode[] {
  for (const node of nodes) {
    if (node.children) sortTree(node.children)
  }
  return nodes.sort(
    (left, right) =>
      Number(left.readable) - Number(right.readable) || left.title.localeCompare(right.title)
  )
}
