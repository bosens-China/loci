import { describe, expect, it } from 'vitest'
import type { UrlTreeNode } from '@loci/shared'
import { parseTreeQueries, resolveReadTargets } from '../library-tree'

describe('文档库目录工具函数', () => {
  it('保留完整问句作为向量检索输入，按逗号分开独立查询', () => {
    expect(parseTreeQueries('How does dependency injection work，Vue 组件如何通信')).toEqual([
      'How does dependency injection work',
      'Vue 组件如何通信'
    ])
  })

  it('P1-4: 勾选目录节点时解析为可读叶子 ID，且 targets 绝不含 folder: 内部键', () => {
    const treeWithFolderKey: UrlTreeNode[] = [
      {
        id: 'folder:react:guide',
        title: 'guide',
        readable: false,
        children: [
          { id: 'doc-intro', title: 'Intro', readable: true },
          { id: 'doc-quickstart', title: 'Quickstart', readable: true }
        ]
      },
      {
        id: 'folder:react:api',
        title: 'api',
        readable: false,
        children: [{ id: 'doc-hooks', title: 'Hooks', readable: true }]
      }
    ]

    // 勾选单个目录节点
    const targetsFromFolder = resolveReadTargets(['folder:react:guide'], treeWithFolderKey)
    expect(targetsFromFolder).toEqual(['doc-intro', 'doc-quickstart'])
    expect(targetsFromFolder.some((t) => t.startsWith('folder:'))).toBe(false)

    // 混合勾选：目录节点 + 单独文档节点 + 重复文档节点
    const mixedTargets = resolveReadTargets(
      ['folder:react:guide', 'doc-intro', 'doc-hooks'],
      treeWithFolderKey
    )
    expect(mixedTargets).toEqual(['doc-intro', 'doc-quickstart', 'doc-hooks'])
    expect(mixedTargets.some((t) => t.startsWith('folder:'))).toBe(false)

    // 筛选或刷新前勾选的文档已不在树中，预览请求只能包含仍可见的文档。
    expect(resolveReadTargets(['doc-intro', 'doc-hidden'], treeWithFolderKey)).toEqual([
      'doc-intro'
    ])

    // 勾选不存在或空的目录节点
    const emptyTargets = resolveReadTargets(['folder:react:unknown'], treeWithFolderKey)
    expect(emptyTargets).toEqual([])
    expect(emptyTargets.some((t) => t.startsWith('folder:'))).toBe(false)
  })
})
