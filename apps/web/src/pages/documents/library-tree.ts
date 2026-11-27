import type { Key } from 'react'
import type { UrlTreeNode } from '@loci/shared'
import { getLibraryTree } from '@/api/documents'

/** 空格属于同一条查询，保留整句语义。 */
export function parseTreeQueries(input: string): string[] {
  return input
    .split(/[,，\r\n]+/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 目录树默认加载深度，支持深层目录避免被截断。 */
export const DEFAULT_TREE_DEPTH = 100

/** 深度加载目录树（当未提供 queries 时，指定 depth 加载） */
export async function loadCompleteLibraryTree(
  libraryId: string,
  queries?: string[]
): Promise<UrlTreeNode[]> {
  return getLibraryTree(libraryId, {
    depth: DEFAULT_TREE_DEPTH,
    queries: queries?.length ? queries : undefined
  })
}

/** 收集树中所有目录节点的 Key，用于默认展开或一键展开 */
export function libraryFolderKeys(nodes: UrlTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.readable ? [] : [node.id, ...libraryFolderKeys(node.children ?? [])]
  )
}

/** 收集树中所有可读叶子节点的 ID */
export function collectReadableDocIds(nodes: UrlTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.readable ? [node.id] : collectReadableDocIds(node.children ?? [])
  )
}

/**
 * 从选中的目录树节点 Key 列表中解析出用于 /api/read 的目标文档列表：
 * 1. 过滤掉内部目录私有标识（`folder:...`），绝不向 /api/read 传入内部 folder key；
 * 2. 若选中了目录节点，递归提取该目录下所有可读叶子文档的真实 ID；
 * 3. 对目标去重，确保 /api/read 获得有效唯一的文档 ID 列表。
 */
export function resolveReadTargets(
  keys: readonly Key[],
  treeNodes: readonly UrlTreeNode[]
): string[] {
  const result = new Set<string>()
  const nodeMap = new Map<string, UrlTreeNode>()

  function indexNodes(nodes: readonly UrlTreeNode[]) {
    for (const node of nodes) {
      nodeMap.set(node.id, node)
      if (node.children) {
        indexNodes(node.children)
      }
    }
  }
  indexNodes(treeNodes)

  for (const rawKey of keys) {
    const node = nodeMap.get(String(rawKey))
    if (!node) continue
    if (node.readable) result.add(node.id)
    else if (node.children) {
      const leafIds = collectReadableDocIds(node.children)
      for (const id of leafIds) {
        result.add(id)
      }
    }
  }

  return Array.from(result)
}
