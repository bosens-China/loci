import type { DocumentSummary } from './api.js'
import type { SearchPassage } from './document-query.js'

export interface UrlTreeItem extends Partial<DocumentSummary>, Partial<SearchPassage> {
  id: string
  title: string
  url: string
  relativePath?: string
  path?: string
}

export interface UrlTreeNode extends Partial<UrlTreeItem> {
  matchedCount?: number
  totalCount?: number
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
    children.push({ ...item, path: documentPath(item), readable: true })
  }
  return sortTree(roots)
}

export function documentPath(item: Pick<UrlTreeItem, 'relativePath' | 'path' | 'url'>): string {
  return (
    '/' +
    (item.relativePath ?? item.path ?? new URL(item.url).pathname)
      .split(/[\\/]/u)
      .filter(Boolean)
      .join('/')
  )
}

/** 先统计完整子树，再裁剪无命中的分支，目录分页仍能展示完整命中比例。 */
export function filterUrlTree(
  roots: readonly UrlTreeNode[],
  matchedIds: ReadonlySet<string>
): UrlTreeNode[] {
  function visit(nodes: readonly UrlTreeNode[]) {
    const result: UrlTreeNode[] = []
    let total = 0
    let matched = 0
    for (const node of nodes) {
      if (node.readable) {
        total++
        if (matchedIds.has(node.id)) {
          matched++
          result.push(node)
        }
      } else {
        const branch = visit(node.children ?? [])
        total += branch.total
        matched += branch.matched
        if (branch.matched)
          result.push({
            ...node,
            children: branch.result,
            totalCount: branch.total,
            matchedCount: branch.matched
          })
      }
    }
    return { total, matched, result }
  }
  return visit(roots).result
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
  const { children: nested, ...metadata } = node
  return depth > 1 && nested
    ? { ...metadata, children: nested.map((child) => limitDepth(child, depth - 1)) }
    : metadata
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
