import type { UrlTreeNode } from '@loci/shared'
import { getLibraryTree, type LibraryLocation } from '@/api/library-browser'

/** 搜索和展开全部共用完整目录元数据；深度超过单次 API 上限时继续读取，不获取正文。 */
export async function loadLibraryTree(
  location: LibraryLocation,
  libraryId: string,
  parentId?: string
): Promise<UrlTreeNode[]> {
  const { nodes } = await getLibraryTree(location, libraryId, parentId, 5)
  const complete = async (node: UrlTreeNode): Promise<UrlTreeNode> => {
    if (node.readable) return node
    const children = node.children
      ? await Promise.all(node.children.map(complete))
      : await loadLibraryTree(location, libraryId, node.id)
    return { ...node, children }
  }
  return Promise.all(nodes.map(complete))
}

/** 先搜索后保留祖先，避免父目录未命中时丢掉匹配子页面。 */
export function filterLibraryTree(nodes: UrlTreeNode[], keyword: string): UrlTreeNode[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return nodes
  return nodes.flatMap((node) => {
    if ([node.title, node.id].some((value) => value.toLowerCase().includes(query))) return [node]
    const children = filterLibraryTree(node.children ?? [], keyword)
    return children.length ? [{ ...node, children }] : []
  })
}

export function libraryFolderKeys(nodes: UrlTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.readable ? [] : [node.id, ...libraryFolderKeys(node.children ?? [])]
  )
}
